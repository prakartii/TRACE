import { API_BASE_URL } from '../config.js'

const base = `${API_BASE_URL}/api/reports`

// Direct download URLs (attachment Content-Disposition is set server-side).
export function incidentsCsvUrl(filters = {}) {
  const p = new URLSearchParams()
  if (filters.videoId) p.set('video_id', filters.videoId)
  if (filters.lens) p.set('lens', filters.lens)
  if (filters.band) p.set('band', filters.band)
  if (filters.status) p.set('status', filters.status)
  const q = p.toString()
  return `${base}/incidents.csv${q ? `?${q}` : ''}`
}

export const shiftSummaryMdUrl = () => `${base}/shift-summary.md`

export async function getShiftSummary() {
  const res = await fetch(`${base}/shift-summary`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
