/**
 * API client for TRACE Safe Action Planner (Feature 3).
 */

import { API_BASE_URL } from '../config.js'

const BASE_URL = `${API_BASE_URL}/api/actions`

/**
 * Fetches the structured SafeActionPlan for a specific recorded event ID.
 * @param {number} eventId
 * @returns {Promise<Object>}
 */
export async function getActionPlan(eventId) {
  if (!eventId) return null

  const res = await fetch(`${BASE_URL}/${eventId}`)
  if (!res.ok) {
    throw new Error(`Failed to load action plan for event #${eventId} (HTTP ${res.status})`)
  }
  return res.json()
}

/**
 * Evaluates an action plan for synthetic or simulated parameters.
 * @param {Object} params
 * @returns {Promise<Object>}
 */
export async function evaluateActionPlan(params) {
  const res = await fetch(`${BASE_URL}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    throw new Error(`Failed to evaluate action plan (HTTP ${res.status})`)
  }
  return res.json()
}
