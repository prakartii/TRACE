import { API_BASE_URL } from '../config.js'

export async function listVideos(options = {}) {
  const res = await fetch(`${API_BASE_URL}/api/videos`)
  if (!res.ok) throw new Error(`Failed to list videos (HTTP ${res.status})`)
  const videos = await res.json()
  if (options?.includeDuplicates) return videos
  return videos.filter((v) => !v.duplicate_of)
}

// Ingest a new MP4 into the monitored set. A full detection -> risk ->
// incident sweep is kicked off in the background on the server the moment
// this returns (backend/video/ingest.py) — poll getAnalyzeStatus(id) for
// progress rather than assuming events exist immediately.
export async function uploadVideo(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE_URL}/api/videos`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    let msg = `Upload failed (HTTP ${res.status})`
    try {
      const d = await res.json()
      if (d.detail) msg = d.detail
    } catch (_) {}
    throw new Error(msg)
  }
  return res.json()
}

// Current/last status of the background ingestion sweep for a video:
// { status: 'not_started' | 'processing' | 'complete' | 'failed', ... }.
// Never fabricated — 'not_started' means this video has never been analyzed.
export async function getAnalyzeStatus(id) {
  const res = await fetch(`${API_BASE_URL}/api/videos/${id}/analyze/status`)
  if (!res.ok) throw new Error(`Failed to load analysis status for ${id} (HTTP ${res.status})`)
  return res.json()
}

// (Re-)triggers the full detection -> risk -> incident sweep for a video.
// Idempotent — safe to call again; re-analysis updates existing incidents
// rather than duplicating them.
export async function analyzeVideo(id) {
  const res = await fetch(`${API_BASE_URL}/api/videos/${id}/analyze`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to start analysis for ${id} (HTTP ${res.status})`)
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

// Fetch all scene graph snapshots for the whole video timeline
export async function getScenes(id, model = 'pilot') {
  const res = await fetch(
    `${API_BASE_URL}/api/videos/${id}/scenes?model=${model}`,
  )
  if (!res.ok) throw new Error(`Failed to load scenes timeline for ${id} (HTTP ${res.status})`)
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
export async function getWhatIf(id, timestamp, scenario = null, candidateId = null, model = 'pilot', entityId = null) {
  let url = `${API_BASE_URL}/api/videos/${id}/what-if?timestamp=${timestamp}&model=${model}`
  if (scenario) url += `&scenario=${encodeURIComponent(scenario)}`
  if (candidateId) url += `&candidate_id=${encodeURIComponent(candidateId)}`
  if (entityId) url += `&entity_id=${encodeURIComponent(entityId)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to run what-if simulation (HTTP ${res.status})`)
  return res.json()
}

export async function simulatePlacement(id, timestamp, scenario = null, candidateId = null, model = 'pilot', entityId = null) {
  const res = await fetch(`${API_BASE_URL}/api/videos/${id}/simulate-placement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestamp,
      finding_scenario: scenario,
      candidate_id: candidateId,
      entity_id: entityId,
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

