import { API_BASE_URL } from '../config.js'

export async function listActiveInterventions(videoId = null) {
  const url = new URL(`${API_BASE_URL}/api/intervention/active`)
  if (videoId) url.searchParams.set('video_id', videoId)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Failed to fetch active interventions: ${res.statusText}`)
  return res.json()
}

export async function listInterventions({ videoId = null, state = null, limit = 50, offset = 0 } = {}) {
  const url = new URL(`${API_BASE_URL}/api/intervention/list`)
  if (videoId) url.searchParams.set('video_id', videoId)
  if (state) url.searchParams.set('state', state)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(offset))
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Failed to list interventions: ${res.statusText}`)
  return res.json()
}

export async function getIntervention(alertId) {
  const res = await fetch(`${API_BASE_URL}/api/intervention/${alertId}`)
  if (!res.ok) throw new Error(`Failed to fetch intervention ${alertId}: ${res.statusText}`)
  return res.json()
}

export async function acknowledgeIntervention(alertId, user = 'operator') {
  const res = await fetch(`${API_BASE_URL}/api/intervention/${alertId}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user }),
  })
  if (!res.ok) throw new Error(`Failed to acknowledge intervention: ${res.statusText}`)
  return res.json()
}

export async function progressIntervention(alertId, notes = null) {
  const res = await fetch(`${API_BASE_URL}/api/intervention/${alertId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  })
  if (!res.ok) throw new Error(`Failed to update progress: ${res.statusText}`)
  return res.json()
}

export async function verifyIntervention(alertId, verifiedBy = 'supervisor', notes = null) {
  const res = await fetch(`${API_BASE_URL}/api/intervention/${alertId}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verified_by: verifiedBy, notes }),
  })
  if (!res.ok) throw new Error(`Failed to verify intervention: ${res.statusText}`)
  return res.json()
}

export async function resolveIntervention(alertId, notes = null, outcomeClassification = 'prevented') {
  const res = await fetch(`${API_BASE_URL}/api/intervention/${alertId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes, outcome_classification: outcomeClassification }),
  })
  if (!res.ok) throw new Error(`Failed to resolve intervention: ${res.statusText}`)
  return res.json()
}

export async function dismissIntervention(alertId, reason = 'Marked as false positive') {
  const res = await fetch(`${API_BASE_URL}/api/intervention/${alertId}/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  if (!res.ok) throw new Error(`Failed to dismiss intervention: ${res.statusText}`)
  return res.json()
}

export async function evaluateEventIntervention(eventId) {
  const res = await fetch(`${API_BASE_URL}/api/intervention/evaluate/${eventId}`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`Failed to evaluate intervention for event ${eventId}: ${res.statusText}`)
  return res.json()
}

export async function seedActiveInterventions(videoId = null) {
  const url = new URL(`${API_BASE_URL}/api/intervention/seed-active`)
  if (videoId) url.searchParams.set('video_id', videoId)
  const res = await fetch(url.toString(), { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to seed interventions: ${res.statusText}`)
  return res.json()
}

// --- Regional Indian-language voice alerts ------------------------------- //

/** Supported spoken-alert languages: [{code, label}], native display names only. */
export async function listAlertLanguages() {
  const res = await fetch(`${API_BASE_URL}/api/intervention/languages`)
  if (!res.ok) throw new Error(`Failed to list alert languages: ${res.statusText}`)
  return res.json()
}

/** Supervisor's server-persisted alert-language preference. */
export async function getAlertLanguage() {
  const res = await fetch(`${API_BASE_URL}/api/intervention/alert-language`)
  if (!res.ok) throw new Error(`Failed to fetch alert language: ${res.statusText}`)
  return res.json()
}

export async function setAlertLanguage(language) {
  const url = new URL(`${API_BASE_URL}/api/intervention/alert-language`)
  url.searchParams.set('language', language)
  const res = await fetch(url.toString(), { method: 'PUT' })
  if (!res.ok) throw new Error(`Failed to set alert language: ${res.statusText}`)
  return res.json()
}

/** The canonical spoken text TRACE will say for this scenario/language. */
export async function getAlertText(scenario, lang, fallback = null) {
  const url = new URL(`${API_BASE_URL}/api/intervention/alert-text`)
  if (scenario) url.searchParams.set('scenario', scenario)
  url.searchParams.set('lang', lang)
  if (fallback) url.searchParams.set('fallback', fallback)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Failed to fetch alert text: ${res.statusText}`)
  return res.json()
}

/** Direct playable URL for the real synthesized speech (MP3) of an alert. */
export function alertAudioUrl(scenario, lang, fallback = null) {
  const url = new URL(`${API_BASE_URL}/api/intervention/alert-audio`)
  if (scenario) url.searchParams.set('scenario', scenario)
  url.searchParams.set('lang', lang)
  if (fallback) url.searchParams.set('fallback', fallback)
  return url.toString()
}
