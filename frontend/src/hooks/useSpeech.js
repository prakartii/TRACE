import { useCallback, useEffect, useRef, useState } from 'react'
import { SUPPORTED_LANGS } from '../lib/voiceAlerts.js'

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

/**
 * Thin wrapper over the Web Speech API for spoken safety alerts.
 * Degrades to a no-op (`supported: false`) where speechSynthesis is absent.
 */
export function useSpeech() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [enabled, setEnabledState] = useState(() => readLS(LS_ENABLED, 'false') === 'true')
  const [lang, setLangState] = useState(() => readLS(LS_LANG, 'en'))
  const [voices, setVoices] = useState([])
  const lastSpokenRef = useRef(null)

  useEffect(() => {
    if (!supported) return undefined
    const load = () => setVoices(window.speechSynthesis.getVoices() || [])
    load()
    window.speechSynthesis.addEventListener?.('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load)
  }, [supported])

  const setEnabled = useCallback((v) => {
    setEnabledState(v)
    try {
      localStorage.setItem(LS_ENABLED, v ? 'true' : 'false')
    } catch {
      /* ignore */
    }
    if (!v && supported) window.speechSynthesis.cancel()
  }, [supported])

  const setLang = useCallback((code) => {
    setLangState(code)
    try {
      localStorage.setItem(LS_LANG, code)
    } catch {
      /* ignore */
    }
  }, [])

  const pickVoice = useCallback(
    (bcp47) => {
      if (!voices.length) return null
      const pref = bcp47.toLowerCase()
      const short = pref.split('-')[0]
      return (
        voices.find((v) => v.lang?.toLowerCase() === pref) ||
        voices.find((v) => v.lang?.toLowerCase().startsWith(short)) ||
        null
      )
    },
    [voices],
  )

  const speak = useCallback(
    (text, { force = false } = {}) => {
      if (!supported || !text) return { ok: false, reason: 'unsupported' }
      if (!force && !enabled) return { ok: false, reason: 'disabled' }
      if (!force && text === lastSpokenRef.current) return { ok: false, reason: 'duplicate' }
      lastSpokenRef.current = text

      const meta = SUPPORTED_LANGS.find((l) => l.code === lang) || SUPPORTED_LANGS[0]
      const u = new SpeechSynthesisUtterance(text)
      u.lang = meta.bcp47
      const v = pickVoice(meta.bcp47)
      if (v) u.voice = v
      u.rate = 1.0
      u.pitch = 1.0
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
      return { ok: true, usedVoiceLang: v?.lang || null, voiceMatched: !!v }
    },
    [supported, enabled, lang, pickVoice],
  )

  const cancel = useCallback(() => {
    if (supported) window.speechSynthesis.cancel()
  }, [supported])

  // Whether the OS actually has a voice for the selected language.
  const meta = SUPPORTED_LANGS.find((l) => l.code === lang) || SUPPORTED_LANGS[0]
  const voiceAvailable = supported && voices.length > 0 && !!pickVoice(meta.bcp47)

  return {
    supported,
    enabled,
    setEnabled,
    lang,
    setLang,
    langs: SUPPORTED_LANGS,
    voiceAvailable,
    speak,
    cancel,
  }
}
