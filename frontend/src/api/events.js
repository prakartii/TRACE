import { API_BASE_URL } from '../config.js'

/**
 * Fetches persisted operational risk events with optional query filters.
 *
 * @param {Object} filters
 * @param {string} [filters.videoId]
 * @param {string} [filters.lens]
 * @param {string} [filters.status]
 * @param {string} [filters.band]
 * @param {boolean} [filters.reviewed]
 * @param {string} [filters.reviewStatus]
 * @param {number} [filters.limit=50]
 * @param {number} [filters.offset=0]
 * @param {string} [filters.order='desc']
 * @returns {Promise<Array>}
 */
export async function listEvents(filters = {}) {
  const params = new URLSearchParams()
  if (filters.videoId) params.set('video_id', filters.videoId)
  if (filters.lens) params.set('lens', filters.lens)
  if (filters.status) params.set('status', filters.status)
  if (filters.band) params.set('band', filters.band)
  if (filters.reviewed !== undefined && filters.reviewed !== null && filters.reviewed !== '') {
    params.set('reviewed', String(filters.reviewed))
  }
  if (filters.reviewStatus) params.set('review_status', filters.reviewStatus)
  if (filters.limit) params.set('limit', String(filters.limit))
  if (filters.offset !== undefined && filters.offset !== null) {
    params.set('offset', String(filters.offset))
  }
  if (filters.order) params.set('order', filters.order)

  const queryString = params.toString()
  const url = `${API_BASE_URL}/api/events${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch events (HTTP ${res.status})`)
  return res.json()
}

/**
 * Fetches a single event with linked planner recommendation and audit breakdown.
 *
 * @param {number|string} eventId
 * @returns {Promise<Object>}
 */
export async function getEvent(eventId) {
  const res = await fetch(`${API_BASE_URL}/api/events/${eventId}`)
  if (!res.ok) throw new Error(`Failed to load event #${eventId} (HTTP ${res.status})`)
  return res.json()
}

/**
 * Submits Responsible AI human operator review feedback.
 *
 * @param {number|string} eventId
 * @param {'confirmed_damage'|'false_positive'|'unresolved'} reviewStatus
 * @param {string} [notes]
 * @returns {Promise<Object>}
 */
export async function submitReview(eventId, reviewStatus, notes = null) {
  const res = await fetch(`${API_BASE_URL}/api/events/${eventId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ review_status: reviewStatus, notes }),
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to submit review (HTTP ${res.status})`)
  }
  return res.json()
}