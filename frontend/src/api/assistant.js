import { API_BASE_URL } from '../config.js'

/**
 * Ask the grounded supervisor assistant a question. Answers are retrieved from
 * the TRACE event database; the response carries its grounding.
 * @param {string} question
 * @returns {Promise<object>}
 */
export async function askAssistant(question) {
  const res = await fetch(`${API_BASE_URL}/api/assistant/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) {
    let msg = `Assistant request failed (HTTP ${res.status})`
    try {
      const d = await res.json()
      if (d.detail) msg = d.detail
    } catch (_) {}
    throw new Error(msg)
  }
  return res.json()
}

export async function getAssistantSuggestions() {
  const res = await fetch(`${API_BASE_URL}/api/assistant/suggestions`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
