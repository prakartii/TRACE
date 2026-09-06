import { API_BASE_URL } from '../config.js'

export async function listVideos() {
  const res = await fetch(`${API_BASE_URL}/api/videos`)
  if (!res.ok) throw new Error(`Failed to list videos (HTTP ${res.status})`)
  return res.json()
}

export async function getVideo(id) {
  const res = await fetch(`${API_BASE_URL}/api/videos/${id}`)
  if (!res.ok) throw new Error(`Failed to load video ${id} (HTTP ${res.status})`)
  return res.json()
}

// Frame access (single decoded frame as JPEG) — the boundary the future
// perception layer's dev/debug tooling will reuse. Not called by the
// playback UI itself, which uses the browser's native video element via
// streamUrl() below.
export function frameUrl(id, timestamp) {
  return `${API_BASE_URL}/api/videos/${id}/frame?timestamp=${timestamp}`
}

export function streamUrl(id) {
  return `${API_BASE_URL}/api/videos/${id}/stream`
}

// Perception (Phase 3, model selection added in Phase 4): detected +
// tracked entities for the sampled frame nearest `timestamp`.
// `model` is 'stock' (default — person-only, production) or 'pilot'
// (experimental person+box+pallet fine-tune, see training/README.md).
// Never silently substituted — the response's `model_identity` field
// states which one actually ran. The FIRST call for a given
// (video, model) pair triggers a full server-side pass over that video
// and can take a while (seconds to roughly a minute depending on video
// length) — callers should show a loading state, not assume this
// resolves quickly.
export async function getEntities(id, timestamp, model = 'stock') {
  const res = await fetch(
    `${API_BASE_URL}/api/videos/${id}/entities?timestamp=${timestamp}&model=${model}`,
  )
  if (!res.ok) throw new Error(`Failed to load entities for ${id} (HTTP ${res.status})`)
  return res.json()
}

// World model (Phase 4): a SceneGraphSnapshot (nodes + spatial-
// relationship edges) for the sampled frame nearest `timestamp`. Same
// `model` parameter and first-call-is-slow/cached-after behavior as
// getEntities, since it's built from the same perception pass.
export async function getScene(id, timestamp, model = 'stock') {
  const res = await fetch(
    `${API_BASE_URL}/api/videos/${id}/scene?timestamp=${timestamp}&model=${model}`,
  )
  if (!res.ok) throw new Error(`Failed to load scene for ${id} (HTTP ${res.status})`)
  return res.json()
}

// Evidence-aware risk findings (Phase 5): a list of RiskEvents from every
// lens that can currently run (behaviour/structural/conformance/
// environmental) for the sampled frame nearest `timestamp`. Same `model`
// parameter and cache-after-first-call behavior as getEntities/getScene.
// Every finding carries an explicit `status` (supported/probable/
// insufficient_evidence/unsupported) — never assume a returned finding is
// a confirmed hazard without checking it.
export async function getFindings(id, timestamp, model = 'stock') {
  const res = await fetch(
    `${API_BASE_URL}/api/videos/${id}/findings?timestamp=${timestamp}&model=${model}`,
  )
  if (!res.ok) throw new Error(`Failed to load findings for ${id} (HTTP ${res.status})`)
  return res.json()
}

// What-If Simulation (Phase 7B): deterministic counterfactual simulation comparing
// current placement stability against alternative placement candidates.
export async function getWhatIf(id, timestamp, scenario = null, candidateId = null, model = 'pilot') {
  let url = `${API_BASE_URL}/api/videos/${id}/what-if?timestamp=${timestamp}&model=${model}`
  if (scenario) url += `&scenario=${encodeURIComponent(scenario)}`
  if (candidateId) url += `&candidate_id=${encodeURIComponent(candidateId)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to run what-if simulation (HTTP ${res.status})`)
  return res.json()
}

export async function simulatePlacement(id, timestamp, scenario = null, candidateId = null, model = 'pilot') {
  const res = await fetch(`${API_BASE_URL}/api/videos/${id}/simulate-placement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestamp,
      finding_scenario: scenario,
      candidate_id: candidateId,
      model,
    }),
  })
  if (!res.ok) throw new Error(`Failed to simulate placement (HTTP ${res.status})`)
  return res.json()
}

export async function getSamplingPolicy(id) {
  const res = await fetch(`${API_BASE_URL}/api/videos/${id}/sampling`)
  if (!res.ok) throw new Error(`Failed to load sampling policy (HTTP ${res.status})`)
  return res.json()
}

// Supervisor Configuration (Phase 7B / Phase 8)
export async function listProducts() {
  const res = await fetch(`${API_BASE_URL}/api/config/products`)
  if (!res.ok) throw new Error(`Failed to list products (HTTP ${res.status})`)
  return res.json()
}

export async function deleteProduct(productId) {
  const res = await fetch(`${API_BASE_URL}/api/config/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `Failed to delete product (HTTP ${res.status})`)
  }
  return res.json()
}

export async function listZones() {
  const res = await fetch(`${API_BASE_URL}/api/config/zones`)
  if (!res.ok) throw new Error(`Failed to list zones (HTTP ${res.status})`)
  return res.json()
}

export async function createZone(zoneConfig) {
  const res = await fetch(`${API_BASE_URL}/api/config/zones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(zoneConfig),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `Failed to create zone (HTTP ${res.status})`)
  }
  return res.json()
}

export async function deleteZone(zoneId) {
  const res = await fetch(`${API_BASE_URL}/api/config/zones/${encodeURIComponent(zoneId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `Failed to delete zone (HTTP ${res.status})`)
  }
  return res.json()
}

export async function listManifests() {
  const res = await fetch(`${API_BASE_URL}/api/config/manifests`)
  if (!res.ok) throw new Error(`Failed to list manifests (HTTP ${res.status})`)
  return res.json()
}

