import { API_BASE_URL } from '../config.js'

/**
 * Fetches the aggregated prevention measurement summary.
 *
 * @param {Object} [filters]
 * @param {string} [filters.videoId]
 * @param {number} [filters.since]
 * @returns {Promise<Object>}
 */
export async function getPreventionSummary(filters = {}) {
  const params = new URLSearchParams()
  if (filters.videoId) params.set('video_id', filters.videoId)
  if (filters.since) params.set('since', String(filters.since))

  const queryString = params.toString()
  const url = `${API_BASE_URL}/api/measurement/summary${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch prevention summary (HTTP ${res.status})`)
  return res.json()
}

/**
 * Lists recorded outcome measurements.
 *
 * @param {Object} [filters]
 * @param {string} [filters.videoId]
 * @param {string} [filters.classification]
 * @param {number} [filters.limit=50]
 * @param {number} [filters.offset=0]
 * @returns {Promise<Array>}
 */
export async function listOutcomes(filters = {}) {
  const params = new URLSearchParams()
  if (filters.videoId) params.set('video_id', filters.videoId)
  if (filters.classification) params.set('classification', filters.classification)
  if (filters.limit) params.set('limit', String(filters.limit))
  if (filters.offset !== undefined && filters.offset !== null) {
    params.set('offset', String(filters.offset))
  }

  const queryString = params.toString()
  const url = `${API_BASE_URL}/api/measurement/outcomes${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to list outcomes (HTTP ${res.status})`)
  return res.json()
}

/**
 * Fetches recorded outcome measurement for a specific event if one exists.
 *
 * @param {number|string} eventId
 * @returns {Promise<Object|null>}
 */
export async function getEventOutcome(eventId) {
  const res = await fetch(`${API_BASE_URL}/api/measurement/events/${eventId}/outcome`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Failed to fetch outcome for event #${eventId} (HTTP ${res.status})`)
  return res.json()
}

/**
 * Triggers operational outcome verification for a specific event.
 *
 * @param {number|string} eventId
 * @param {number} [windowSec=5.0]
 * @returns {Promise<Object>}
 */
export async function verifyEventOutcome(eventId, windowSec = 5.0) {
  const url = `${API_BASE_URL}/api/measurement/events/${eventId}/verify?window_sec=${encodeURIComponent(windowSec)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    let errorMsg = `Verification failed (HTTP ${res.status})`
    try {
      const data = await res.json()
      if (data.detail) errorMsg = data.detail
    } catch (_) {}
    throw new Error(errorMsg)
  }
  return res.json()
}

/**
 * Records a 1–5 human-impact session rating.
 * @param {number} rating 1–5
 * @param {string} [sessionId]
 * @returns {Promise<Object>}
 */
export async function submitSessionRating(rating, sessionId = null) {
  const res = await fetch(`${API_BASE_URL}/api/measurement/rating`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, session_id: sessionId }),
  })
  if (!res.ok) {
    let errorMsg = `Failed to submit rating (HTTP ${res.status})`
    try {
      const data = await res.json()
      if (data.detail) errorMsg = data.detail
    } catch (_) {}
    throw new Error(errorMsg)
  }
  return res.json()
}
