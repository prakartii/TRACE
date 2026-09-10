import { useCallback, useEffect, useRef, useState } from 'react'
import {
  alertAudioUrl,
  getAlertLanguage,
  listAlertLanguages,
  setAlertLanguage as persistAlertLanguage,
} from '../api/intervention.js'

const LS_ENABLED = 'trace.voiceAlerts.enabled'
const LS_LANG = 'trace.voiceAlerts.lang'

function readLS(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : v
  } catch {
    return fallback
  }
}

// Instant-paint default before the backend's language list loads. Overwritten
// as soon as `GET /api/intervention/languages` responds.
const FALLBACK_LANGS = [{ code: 'en', label: 'English', bcp47: 'en-IN' }]

/**
 * Spoken safety alerts. Primary path plays real server-synthesized speech
 * (backend/intervention/tts.py — actually renders the requested Indian
 * language, cached to disk) via an <audio> element. The browser's Web
 * Speech API is used ONLY as a fallback when that audio is unavailable
 * (e.g. offline before first use), and only when a matching OS voice for
 * the language genuinely exists — never a silent language substitution,
 * which is what previously produced non-Indian-language speech.
 */
export function useSpeech() {
  const supported = typeof window !== 'undefined' && typeof Audio !== 'undefined'
  // Voice alerts default ON: a safety alert that requires the supervisor to
  // remember to switch on a toggle before it will ever speak defeats the
  // point of an audible warning. The Header toggle remains available to
  // mute it, but the default is opt-out, not opt-in.
  const [enabled, setEnabledState] = useState(() => readLS(LS_ENABLED, 'true') === 'true')
  const [lang, setLangState] = useState(() => readLS(LS_LANG, 'en'))
  const [langs, setLangs] = useState(FALLBACK_LANGS)
  const [browserVoices, setBrowserVoices] = useState([])
  const lastSpokenRef = useRef(null)
  const audioRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    listAlertLanguages()
      .then((d) => {
        if (!cancelled && d.languages?.length) setLangs(d.languages)
      })
      .catch(() => {
        /* keep FALLBACK_LANGS — voice toggle still works in English */
      })
    // Server-persisted supervisor preference wins once it loads; localStorage
    // is only the instant-paint cache used before this resolves.
    getAlertLanguage()
      .then((d) => {
        if (!cancelled && d.language) {
          setLangState(d.language)
          try {
            localStorage.setItem(LS_LANG, d.language)
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined
    const load = () => setBrowserVoices(window.speechSynthesis.getVoices() || [])
    load()
    window.speechSynthesis.addEventListener?.('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load)
  }, [])

  const setEnabled = useCallback((v) => {
    setEnabledState(v)
    try {
      localStorage.setItem(LS_ENABLED, v ? 'true' : 'false')
    } catch {
      /* ignore */
    }
    if (!v) {
      audioRef.current?.pause()
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
    }
  }, [])

  const setLang = useCallback((code) => {
    setLangState(code)
    try {
      localStorage.setItem(LS_LANG, code)
    } catch {
      /* ignore */
    }
    persistAlertLanguage(code).catch(() => {
      /* preference still applies for this session even if persistence fails */
    })
  }, [])

  const currentLangMeta = langs.find((l) => l.code === lang) || langs[0]

  const browserVoiceFor = useCallback(
    (bcp47) => {
      if (!browserVoices.length || !bcp47) return null
      const pref = bcp47.toLowerCase()
      const short = pref.split('-')[0]
      return (
        browserVoices.find((v) => v.lang?.toLowerCase() === pref) ||
        browserVoices.find((v) => v.lang?.toLowerCase().startsWith(short)) ||
        null
      )
    },
    [browserVoices],
  )

  // Whether the OS has a genuine voice for the selected language — only
  // relevant to the fallback path; the primary (backend audio) path never
  // depends on this.
  const voiceAvailable =
    typeof window !== 'undefined' && 'speechSynthesis' in window && !!browserVoiceFor(currentLangMeta?.bcp47)

  const cancel = useCallback(() => {
    audioRef.current?.pause()
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
  }, [])

  /**
   * Speaks `alert` (an InterventionAlert — needs `.scenario` and, as a
   * secondary-source fallback phrase, `.immediate_action`). `force` bypasses
   * the enabled/dedup checks (used by manual "speak this alert" controls).
   */
  const speak = useCallback(
    (alert, { force = false } = {}) => {
      if (!supported || !alert) return { ok: false, reason: 'unsupported' }
      if (!force && !enabled) return { ok: false, reason: 'disabled' }
      const dedupeKey = `${alert.alert_id || alert.scenario || 'generic'}::${lang}`
      if (!force && dedupeKey === lastSpokenRef.current) return { ok: false, reason: 'duplicate' }
      lastSpokenRef.current = dedupeKey

      cancel()
      const url = alertAudioUrl(alert.scenario, lang, alert.immediate_action)
      const audioEl = new Audio(url)
      audioRef.current = audioEl
      audioEl
        .play()
        .catch(() => {
          // Backend audio unavailable (e.g. offline). Fall back to the OS
          // voice ONLY if one genuinely exists for this language — never a
          // silent substitution to a different installed voice.
          const meta = currentLangMeta
          const v = meta && browserVoiceFor(meta.bcp47)
          if (!v || typeof window === 'undefined' || !window.speechSynthesis) return
          const u = new SpeechSynthesisUtterance(alert.immediate_action || alert.title || '')
          u.lang = meta.bcp47
          u.voice = v
          window.speechSynthesis.cancel()
          window.speechSynthesis.speak(u)
        })
      return { ok: true, url }
    },
    [supported, enabled, lang, currentLangMeta, browserVoiceFor, cancel],
  )

  return {
    supported,
    enabled,
    setEnabled,
    lang,
    setLang,
    langs,
    voiceAvailable,
    speak,
    cancel,
  }
}
