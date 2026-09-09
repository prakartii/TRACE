import { useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, RefreshCw, ShieldAlert, Volume2, X } from 'lucide-react'
import { useIntervention } from '../../context/InterventionContext.jsx'
import { spokenTextFor } from '../../lib/voiceAlerts.js'

export default function InterventionBanner({ onOpenDetail }) {
  const {
    bannerAlert,
    connectionStatus,
    connectionNotice,
    acknowledgeAlert,
    dismissBanner,
    voice,
  } = useIntervention()

  const [acknowledging, setAcknowledging] = useState(false)

  // 1. Connection notification banner when disconnected
  if (connectionNotice) {
    return (
      <div className="mb-5 flex items-center justify-between rounded-lg border border-high/40 bg-high/10 px-4 py-2.5 text-xs text-ink transition-all">
        <div className="flex items-center gap-2.5">
          <RefreshCw className="h-4 w-4 animate-spin text-high" />
          <div>
            <span className="font-semibold text-ink">Live Monitoring Status:</span>{' '}
            <span className="text-dim">{connectionNotice}</span>
          </div>
        </div>
        <span className="rounded bg-bg px-2 py-0.5 text-[11px] font-medium text-dim border border-line">
          Reconnecting automatically
        </span>
      </div>
    )
  }

  // 2. Active intervention banner
  if (!bannerAlert) return null

  const isCritical = bannerAlert.severity === 'CRITICAL'
  const isHigh = bannerAlert.severity === 'HIGH'

  const borderClass = isCritical
    ? 'border-crit/60 bg-crit/10'
    : isHigh
    ? 'border-high/50 bg-high/10'
    : 'border-line-strong/40 bg-dim/10'

  const badgeClass = isCritical
    ? 'bg-crit text-white'
    : isHigh
    ? 'bg-high text-ink font-semibold'
    : 'bg-dim text-white'

  const handleAcknowledge = async (e) => {
    e.stopPropagation()
    setAcknowledging(true)
    try {
      await acknowledgeAlert(bannerAlert.alert_id, 'supervisor_lead')
    } catch (err) {
      console.error(err)
    } finally {
      setAcknowledging(false)
    }
  }

  return (
    <div
      className={`mb-6 overflow-hidden rounded-xl border-2 shadow-sm transition-all ${borderClass}`}
      role="alert"
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: What is happening + Urgency */}
        <div className="flex items-start gap-3.5">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              isCritical ? 'bg-crit text-white' : 'bg-high text-ink'
            }`}
          >
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-bold tracking-wider uppercase ${badgeClass}`}
              >
                {bannerAlert.severity} — {bannerAlert.urgency}
              </span>
              {bannerAlert.occurrence_count > 1 && (
                <span className="rounded border border-line-strong bg-bg px-2 py-0.5 text-[11px] font-medium text-dim">
                  Repeated {bannerAlert.occurrence_count}× in active session
                </span>
              )}
              {bannerAlert.state === 'ACKNOWLEDGED' && (
                <span className="rounded bg-high/20 px-2 py-0.5 text-[11px] font-semibold text-high">
                  Acknowledged by {bannerAlert.acknowledged_by || 'Supervisor'}
                </span>
              )}
            </div>

            <h3 className="mt-1 text-base font-bold text-ink">
              {bannerAlert.title}
            </h3>

            {/* WHAT TO DO NOW (Primary prominent scan element) */}
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-dim">
                Action:
              </span>
              <p className="text-sm font-semibold text-ink">
                {bannerAlert.immediate_action}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Operational Actions */}
        <div className="flex items-center gap-2.5 sm:self-center">
          {bannerAlert.state === 'NEW' && (
            <button
              type="button"
              onClick={handleAcknowledge}
              disabled={acknowledging}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink bg-ink px-3.5 py-1.5 text-xs font-semibold text-bg shadow-sm transition-all hover:bg-dim active:scale-95 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {acknowledging ? 'Acknowledging...' : 'Acknowledge'}
            </button>
          )}

          {voice?.supported && (
            <button
              type="button"
              onClick={() =>
                voice.speak(spokenTextFor(bannerAlert, voice.lang), { force: true })
              }
              title={`Speak this alert${voice.enabled ? '' : ' (voice alerts off)'}`}
              className="rounded-lg border border-line-strong bg-bg p-1.5 text-ink shadow-sm transition-all hover:bg-raised active:scale-95"
            >
              <Volume2 aria-label="Speak this alert" className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => onOpenDetail && onOpenDetail(bannerAlert)}
            className="inline-flex items-center gap-1 rounded-lg border border-line-strong bg-bg px-3 py-1.5 text-xs font-medium text-ink shadow-sm transition-all hover:bg-raised active:scale-95"
          >
            <span>View Safe Plan</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => dismissBanner(bannerAlert.alert_id)}
            className="rounded p-1.5 text-mute transition-colors hover:bg-bg hover:text-ink"
            title="Dismiss from banner"
          >
            <X aria-label="Dismiss" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
