/**
 * Behaviour Recognition API client (Phase 12).
 * ARCHITECTURE.md Part 3 & Part 11.
 */

const API_BASE = '/api/behaviour'

export async function listBehaviourScenarios() {
  const res = await fetch(`${API_BASE}/scenarios`)
  if (!res.ok) {
    throw new Error(`Failed to list behaviour scenarios: ${res.statusText}`)
  }
  return res.json()
}

export async function getBehaviourScenario(scenarioId) {
  const res = await fetch(`${API_BASE}/scenarios/${encodeURIComponent(scenarioId)}`)
  if (!res.ok) {
    throw new Error(`Failed to get scenario ${scenarioId}: ${res.statusText}`)
  }
  return res.json()
}

export async function evaluateVideoBehaviour(videoId, timestamp = 0.0, model = 'pilot') {
  const params = new URLSearchParams({
    timestamp: timestamp.toString(),
    model,
  })
  const res = await fetch(`${API_BASE}/video/${encodeURIComponent(videoId)}?${params}`)
  if (!res.ok) {
    throw new Error(`Failed to evaluate video behaviour: ${res.statusText}`)
  }
  return res.json()
}

export async function evaluateBehaviour(payload) {
  const res = await fetch(`${API_BASE}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`Failed to evaluate behaviour: ${res.statusText}`)
  }
  return res.json()
}
