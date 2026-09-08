import { API_BASE_URL } from '../config.js'

const base = `${API_BASE_URL}/api/learning`

async function json(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export const getPatterns = () => fetch(`${base}/patterns`).then(json)
export const getHeatmap = () => fetch(`${base}/heatmap`).then(json)
export const getScorecards = () => fetch(`${base}/scorecards`).then(json)
