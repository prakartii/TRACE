import { API_BASE_URL } from '../config.js'

export async function listLiveSources() {
  const res = await fetch(`${API_BASE_URL}/api/live`)
  if (!res.ok) throw new Error(`Failed to list live sources (HTTP ${res.status})`)
  return res.json()
}

export function liveStreamWsUrl(sourceId) {
  return `${API_BASE_URL.replace(/^http/, 'ws')}/api/live/${sourceId}/stream`
}
