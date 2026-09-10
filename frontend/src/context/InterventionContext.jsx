import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { API_BASE_URL } from '../config.js'
import { useSpeech } from '../hooks/useSpeech.js'
import {
  listActiveInterventions,
  acknowledgeIntervention,
  progressIntervention,
  verifyIntervention,
  resolveIntervention,
  dismissIntervention,
} from '../api/intervention.js'

const InterventionContext = createContext(null)

const WS_URL = `${API_BASE_URL.replace(/^http/, 'ws')}/api/intervention/ws`

export function InterventionProvider({ children }) {
  const [activeAlerts, setActiveAlerts] = useState([])
  const [connectionStatus, setConnectionStatus] = useState('connecting') // connecting | connected | disconnected | error
  const [connectionNotice, setConnectionNotice] = useState(null)
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [dismissedBannerIds, setDismissedBannerIds] = useState(new Set())
  const socketRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const reconnectDelayRef = useRef(2000)

  // Load baseline active alerts via REST
  const fetchActive = useCallback(async () => {
    try {
      const data = await listActiveInterventions()
      setActiveAlerts(Array.isArray(data) ? data : [])
    } catch (err) {
      console.warn('Could not fetch active interventions:', err)
    }
  }, [])

  // WebSocket Connection Management with Reconnect & Fallback
  useEffect(() => {
    let isCancelled = false

    function connect() {
      if (isCancelled) return
      setConnectionStatus('connecting')

      try {
        const socket = new WebSocket(WS_URL)
        socketRef.current = socket

        socket.onopen = () => {
          if (isCancelled) return
          setConnectionStatus('connected')
          setConnectionNotice(null)
          reconnectDelayRef.current = 2000 // Reset backoff
          // Heartbeat ping every 25s
          const pingInterval = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send('ping')
            }
          }, 25000)
          socket._pingInterval = pingInterval
        }

        socket.onmessage = (event) => {
          if (isCancelled) return
          if (event.data === 'pong') return
          try {
            const msg = JSON.parse(event.data)
            if (msg.type === 'init' && Array.isArray(msg.alerts)) {
              setActiveAlerts(msg.alerts)
            } else if (msg.type === 'alert_created' && msg.alert) {
              setActiveAlerts((prev) => {
                const idx = prev.findIndex((a) => a.alert_id === msg.alert.alert_id || a.dedup_key === msg.alert.dedup_key)
                if (idx >= 0) {
                  const copy = [...prev]
                  copy[idx] = msg.alert
                  return copy
                }
                return [msg.alert, ...prev]
              })
            } else if (msg.type === 'alert_updated' && msg.alert) {
              setActiveAlerts((prev) => {
                const idx = prev.findIndex((a) => a.alert_id === msg.alert.alert_id || a.dedup_key === msg.alert.dedup_key)
                if (idx >= 0) {
                  const copy = [...prev]
                  copy[idx] = msg.alert
                  return copy
                }
                return [msg.alert, ...prev]
              })
            } else if ((msg.type === 'alert_resolved' || msg.type === 'alert_dismissed') && msg.alert) {
              setActiveAlerts((prev) => prev.filter((a) => a.alert_id !== msg.alert.alert_id))
            }
          } catch {
            // Ignore non-json messages safely
          }
        }

        socket.onerror = () => {
          if (isCancelled) return
          setConnectionStatus('error')
          setConnectionNotice('Live monitoring temporarily unavailable')
        }

        socket.onclose = () => {
          if (isCancelled) return
          if (socket._pingInterval) clearInterval(socket._pingInterval)
          setConnectionStatus('disconnected')
          setConnectionNotice('Live monitoring temporarily unavailable')

          // Reconnect with backoff
          const delay = reconnectDelayRef.current
          reconnectDelayRef.current = Math.min(delay * 1.5, 15000)
          reconnectTimeoutRef.current = setTimeout(connect, delay)
        }
      } catch {
        setConnectionStatus('disconnected')
        setConnectionNotice('Live monitoring temporarily unavailable')
        reconnectTimeoutRef.current = setTimeout(connect, 5000)
      }
    }

    connect()
    fetchActive()

    // Fallback polling interval (every 10s)
    const pollInterval = setInterval(() => {
      if (connectionStatus !== 'connected') {
        fetchActive()
      }
    }, 10000)

    return () => {
      isCancelled = true
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      clearInterval(pollInterval)
      if (socketRef.current) {
        if (socketRef.current._pingInterval) clearInterval(socketRef.current._pingInterval)
        socketRef.current.close()
      }
    }
  }, [fetchActive, connectionStatus])

  // Lifecycle actions
  const acknowledgeAlert = async (alertId, user = 'operator') => {
    try {
      const updated = await acknowledgeIntervention(alertId, user)
      setActiveAlerts((prev) => prev.map((a) => (a.alert_id === alertId ? updated : a)))
      if (selectedAlert?.alert_id === alertId) setSelectedAlert(updated)
      return updated
    } catch (err) {
      console.error('Failed to acknowledge alert:', err)
      throw err
    }
  }

  const progressAlert = async (alertId, notes = null) => {
    try {
      const updated = await progressIntervention(alertId, notes)
      setActiveAlerts((prev) => prev.map((a) => (a.alert_id === alertId ? updated : a)))
      if (selectedAlert?.alert_id === alertId) setSelectedAlert(updated)
      return updated
    } catch (err) {
      console.error('Failed to progress alert:', err)
      throw err
    }
  }

  const verifyAlert = async (alertId, verifiedBy = 'supervisor', notes = null) => {
    try {
      const updated = await verifyIntervention(alertId, verifiedBy, notes)
      setActiveAlerts((prev) => prev.map((a) => (a.alert_id === alertId ? updated : a)))
      if (selectedAlert?.alert_id === alertId) setSelectedAlert(updated)
      return updated
    } catch (err) {
      console.error('Failed to verify alert:', err)
      throw err
    }
  }

  const resolveAlert = async (alertId, notes = null, classification = 'prevented') => {
    try {
      const updated = await resolveIntervention(alertId, notes, classification)
      setActiveAlerts((prev) => prev.filter((a) => a.alert_id !== alertId))
      if (selectedAlert?.alert_id === alertId) setSelectedAlert(null)
      return updated
    } catch (err) {
      console.error('Failed to resolve alert:', err)
      throw err
    }
  }

  const dismissAlert = async (alertId, reason = 'Marked as false positive') => {
    try {
      const updated = await dismissIntervention(alertId, reason)
      setActiveAlerts((prev) => prev.filter((a) => a.alert_id !== alertId))
      if (selectedAlert?.alert_id === alertId) setSelectedAlert(null)
      return updated
    } catch (err) {
      console.error('Failed to dismiss alert:', err)
      throw err
    }
  }

  const dismissBanner = (alertId) => {
    setDismissedBannerIds((prev) => new Set([...prev, alertId]))
  }

  // Top active banner alert: prefer an alert that still actually needs
  // action (state NEW) over one already acknowledged/in-progress, so
  // acknowledging alert #1 advances the banner (and voice) to alert #2
  // instead of continuing to show/speak the same acknowledged alert.
  // Within that, highest severity first; never a dismissed alert.
  const candidates = activeAlerts.filter((a) => !dismissedBannerIds.has(a.alert_id))
  const bannerAlert =
    candidates.find((a) => a.state === 'NEW' && (a.severity === 'CRITICAL' || a.severity === 'HIGH')) ||
    candidates.find((a) => a.state === 'NEW') ||
    candidates.find((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH') ||
    candidates[0] ||
    null

  // Regional Indian-language voice alerts. Speak a NEW banner alert once, in
  // the supervisor's configured language, from the canonical backend phrase
  // bank (backend/intervention/alert_phrases.py) — never a second, frontend
  // -only translation table. Only CRITICAL/HIGH severity auto-speaks;
  // MEDIUM/LOW hazards remain visual-only so voice alerts don't spam.
  const voice = useSpeech()
  const spokenAlertIdRef = useRef(null)
  useEffect(() => {
    if (!voice.enabled || !bannerAlert) return
    if (bannerAlert.state !== 'NEW') return
    if (bannerAlert.severity !== 'CRITICAL' && bannerAlert.severity !== 'HIGH') return
    if (spokenAlertIdRef.current === bannerAlert.alert_id) return
    spokenAlertIdRef.current = bannerAlert.alert_id
    voice.speak(bannerAlert)
  }, [bannerAlert, voice])

  return (
    <InterventionContext.Provider
      value={{
        activeAlerts,
        activeCount: activeAlerts.length,
        connectionStatus,
        connectionNotice,
        bannerAlert,
        selectedAlert,
        setSelectedAlert,
        acknowledgeAlert,
        progressAlert,
        verifyAlert,
        resolveAlert,
        dismissAlert,
        dismissBanner,
        refresh: fetchActive,
        voice,
      }}
    >
      {children}
    </InterventionContext.Provider>
  )
}

export function useIntervention() {
  const ctx = useContext(InterventionContext)
  if (!ctx) throw new Error('useIntervention must be used within an InterventionProvider')
  return ctx
}
