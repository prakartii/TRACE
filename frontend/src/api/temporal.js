import { API_BASE_URL } from '../config.js'

/**
 * Fetches temporal sequence patterns for events.
 *
 * @param {Object} [options]
 * @param {string} [options.videoId]
 * @param {string} [options.scenario]
 * @param {string} [options.lens]
 * @param {number} [options.windowSec=120]
 * @param {number} [options.anchorTimestamp]
 * @param {number} [options.minEvents=2]
 * @returns {Promise<Object>}
 */
export async function getTemporalPatterns(options = {}) {
  const params = new URLSearchParams()
  if (options.videoId) params.set('video_id', options.videoId)
  if (options.scenario) params.set('scenario', options.scenario)
  if (options.lens) params.set('lens', options.lens)
  if (options.windowSec != null) params.set('window_sec', String(options.windowSec))
  if (options.anchorTimestamp != null) params.set('anchor_timestamp', String(options.anchorTimestamp))
  if (options.minEvents != null) params.set('min_events', String(options.minEvents))

  const queryString = params.toString()
  const url = `${API_BASE_URL}/api/temporal/patterns${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch temporal patterns (HTTP ${res.status})`)
  return res.json()
}

/**
 * Fetches predictive risk forecasts grounded in temporal sequences.
 *
 * @param {Object} [options]
 * @param {string} [options.videoId]
 * @param {string} [options.scenario]
 * @param {string} [options.lens]
 * @param {number} [options.windowSec=120]
 * @param {number} [options.anchorTimestamp]
 * @returns {Promise<Object>}
 */
export async function getPredictiveRisk(options = {}) {
  const params = new URLSearchParams()
  if (options.videoId) params.set('video_id', options.videoId)
  if (options.scenario) params.set('scenario', options.scenario)
  if (options.lens) params.set('lens', options.lens)
  if (options.windowSec != null) params.set('window_sec', String(options.windowSec))
  if (options.anchorTimestamp != null) params.set('anchor_timestamp', String(options.anchorTimestamp))

  const queryString = params.toString()
  const url = `${API_BASE_URL}/api/temporal/predict${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch predictive risk (HTTP ${res.status})`)
  return res.json()
}

/**
 * Fetches high-level summary of temporal patterns and top prediction for widgets.
 *
 * @param {Object} [options]
 * @param {string} [options.videoId]
 * @param {number} [options.windowSec=120]
 * @returns {Promise<Object>}
 */
export async function getTemporalSummary(options = {}) {
  const params = new URLSearchParams()
  if (options.videoId) params.set('video_id', options.videoId)
  if (options.windowSec != null) params.set('window_sec', String(options.windowSec))

  const queryString = params.toString()
  const url = `${API_BASE_URL}/api/temporal/summary${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch temporal summary (HTTP ${res.status})`)
  return res.json()
}
