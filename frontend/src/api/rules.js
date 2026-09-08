/**
 * API client for TRACE Custom Rule Builder.
 * All calls go to /api/rules/* — matches backend/api/rules.py router.
 */

import { API_BASE_URL } from '../config.js'

const BASE = `${API_BASE_URL}/api/rules`

async function handleResponse(res) {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const data = await res.json()
      detail = data.detail
        ? typeof data.detail === 'string'
          ? data.detail
          : data.detail.message || JSON.stringify(data.detail)
        : detail
    } catch (_) {}
    throw new Error(detail)
  }
  return res.json()
}

/** Returns the vocabulary of allowed fields and operators (use to build UI dropdowns). */
export async function getRuleSchema() {
  return handleResponse(await fetch(`${BASE}/schema`))
}

/** Lists all custom rules, most recently created first. */
export async function listRules() {
  return handleResponse(await fetch(BASE))
}

/** Gets a single custom rule by ID. */
export async function getRule(ruleId) {
  return handleResponse(await fetch(`${BASE}/${ruleId}`))
}

/**
 * Creates a new custom rule.
 * @param {object} rule - { name, description, lens, severity_band, enabled, action_text, condition, created_by }
 */
export async function createRule(rule) {
  return handleResponse(
    await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    }),
  )
}

/**
 * Updates an existing rule (partial update — only send fields to change).
 * @param {number} ruleId
 * @param {object} updates
 */
export async function updateRule(ruleId, updates) {
  return handleResponse(
    await fetch(`${BASE}/${ruleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }),
  )
}

/** Deletes a rule by ID. */
export async function deleteRule(ruleId) {
  return handleResponse(
    await fetch(`${BASE}/${ruleId}`, { method: 'DELETE' }),
  )
}

/**
 * Evaluates a rule against the full TRACE event database.
 * Returns matched_count, matched_event_ids, sample_matches, epistemic_label.
 */
export async function evaluateRule(ruleId) {
  return handleResponse(
    await fetch(`${BASE}/${ruleId}/evaluate`, { method: 'POST' }),
  )
}
