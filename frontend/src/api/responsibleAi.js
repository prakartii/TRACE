import { API_BASE_URL } from '../config.js'

const base = `${API_BASE_URL}/api/responsible-ai`

async function json(res) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const d = await res.json()
      if (d.detail) msg = d.detail
    } catch (_) {}
    throw new Error(msg)
  }
  return res.json()
}

export const getGovernanceStatus = () => fetch(`${base}/status`).then(json)
export const getRetention = () => fetch(`${base}/retention`).then(json)

export const putRetention = (windowDays, autoPurge) =>
  fetch(`${base}/retention`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ window_days: windowDays, auto_purge: autoPurge }),
  }).then(json)

export const runPurge = (confirm = false) =>
  fetch(`${base}/retention/purge?confirm=${confirm ? 'true' : 'false'}`, { method: 'POST' }).then(json)
