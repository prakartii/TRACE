import { API_BASE_URL } from '../config.js'

/**
 * Executes a multi-frame temporal what-if counterfactual simulation.
 *
 * @param {Object} params
 * @param {number} [params.eventId]
 * @param {string} [params.videoId]
 * @param {number} [params.timestamp]
 * @param {string} [params.scenario]
 * @param {string} [params.entityId]
 * @param {string} [params.alternativeCandidate]
 * @param {string} [params.model='pilot']
 * @param {number} [params.windowBefore=3.0]
 * @param {number} [params.windowAfter=4.0]
 * @returns {Promise<Object>}
 */
export async function getTrajectoryWhatIf(params = {}) {
  const res = await fetch(`${API_BASE_URL}/api/planner/whatif`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: params.eventId || null,
      video_id: params.videoId || null,
      timestamp: params.timestamp !== undefined ? params.timestamp : null,
      scenario: params.scenario || null,
      entity_id: params.entityId || null,
      alternative_candidate: params.alternativeCandidate || null,
      model: params.model || 'pilot',
      window_before: params.windowBefore !== undefined ? params.windowBefore : 3.0,
      window_after: params.windowAfter !== undefined ? params.windowAfter : 4.0,
    }),
  })

  if (!res.ok) {
    let errorMsg = `What-If simulation failed (HTTP ${res.status})`
    try {
      const data = await res.json()
      if (data.detail) errorMsg = data.detail
    } catch (_) {}
    throw new Error(errorMsg)
  }
  return res.json()
}

/**
 * Retrieves multi-frame temporal what-if trajectory simulation for a specific event.
 *
 * @param {number|string} eventId
 * @param {string} [candidateId]
 * @param {string} [model='pilot']
 * @returns {Promise<Object>}
 */
export async function getEventTrajectory(eventId, candidateId = null, model = 'pilot') {
  const params = new URLSearchParams()
  if (candidateId) params.set('candidate_id', candidateId)
  if (model) params.set('model', model)

  const queryString = params.toString()
  const url = `${API_BASE_URL}/api/planner/whatif/${eventId}${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url)
  if (!res.ok) {
    let errorMsg = `Failed to load trajectory for event #${eventId} (HTTP ${res.status})`
    try {
      const data = await res.json()
      if (data.detail) errorMsg = data.detail
    } catch (_) {}
    throw new Error(errorMsg)
  }
  return res.json()
}

/**
 * Retrieves the authoritative list of validated events supported for What-If safety simulation.
 *
 * @param {string} [videoId]
 * @returns {Promise<Array<Object>>}
 */
export async function getSupportedWhatIfEvents(videoId = null) {
  const url = videoId
    ? `${API_BASE_URL}/api/planner/whatif/supported?video_id=${encodeURIComponent(videoId)}`
    : `${API_BASE_URL}/api/planner/whatif/supported`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to load supported What-If events (HTTP ${res.status})`)
  }
  return res.json()
}

/**
 * Retrieves evidence-grounded What-If Safety Simulation for an event.
 *
 * @param {number|string} eventId
 * @returns {Promise<Object>}
 */
export async function getSafetyWhatIfSimulation(eventId) {
  const url = `${API_BASE_URL}/api/planner/whatif/simulation/${eventId}`
  const res = await fetch(url)
  if (!res.ok) {
    let errorMsg = `Failed to load What-If simulation for event #${eventId} (HTTP ${res.status})`
    try {
      const data = await res.json()
      if (data.detail) errorMsg = data.detail
    } catch (_) {}
    throw new Error(errorMsg)
  }
  return res.json()
}

