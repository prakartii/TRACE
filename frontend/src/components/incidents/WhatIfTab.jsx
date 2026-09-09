import { useEffect, useMemo, useState } from 'react'
import { getEventTrajectory } from '../../api/whatif.js'

const W = 560
const H = 200
const PAD = { l: 34, r: 12, t: 12, b: 26 }

function RiskChart({ original, simulated, placementIndex }) {
  const n = Math.max(original.length, simulated.length)
  if (n < 2) return null
  const x = (i) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r)
  const y = (v) => PAD.t + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - PAD.t - PAD.b)
  const line = (pts) => pts.map((p, i) => `${x(i)},${y(p.risk_score ?? 0)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Risk over time: observed vs simulated alternative.">
      <g fontFamily="ui-monospace, Menlo, monospace" fontSize="9" fill="#9a9a9a">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} stroke={v === 0 ? '#cfcfcf' : '#f0f0f0'} />
            <text x={PAD.l - 5} y={y(v) + 3} textAnchor="end">{v}</text>
          </g>
        ))}
        <text x={PAD.l} y={H - 8}>start</text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end">end</text>
        {placementIndex >= 0 && (
          <>
            <line x1={x(placementIndex)} y1={PAD.t} x2={x(placementIndex)} y2={H - PAD.b} stroke="#cfcfcf" strokeDasharray="2 3" />
            <text x={x(placementIndex)} y={H - 8} textAnchor="middle">placement</text>
          </>
        )}
      </g>
      <polyline fill="none" stroke="#1a1a1a" strokeWidth="1.75" points={line(original)} />
      <polyline fill="none" stroke="#c77700" strokeWidth="1.75" strokeDasharray="5 4" points={line(simulated)} />
      <g fontFamily="ui-monospace, Menlo, monospace" fontSize="9">
        <text x={W - PAD.r} y={PAD.t + 2} textAnchor="end" fill="#1a1a1a">observed</text>
        <text x={W - PAD.r} y={PAD.t + 14} textAnchor="end" fill="#c77700">simulated</text>
      </g>
    </svg>
  )
}

export default function WhatIfTab({ eventId }) {
  const [data, setData] = useState(null)
  const [candidateId, setCandidateId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getEventTrajectory(eventId, candidateId, 'pilot')
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [eventId, candidateId])

  const placementIndex = useMemo(() => {
    const t = data?.original_trajectory || []
    return t.findIndex((p) => p.is_placement_moment)
  }, [data])

  if (loading) return <p className="text-caption text-mute">loading…</p>
  if (error) return <p className="text-caption text-crit">[error] {error}</p>
  if (!data) return null

  const candidates = data.available_candidates || []

  if (!data.simulation_available) {
    return (
      <div className="panel bg-bg">
        <span className="eyebrow mb-2 block">What-If not applicable</span>
        <p className="text-caption text-dim">
          {data.simulation_notice ||
            'No feasible alternative placement exists for this frame, so no counterfactual can be shown.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {candidates.length > 1 && (
        <label className="flex items-center gap-2 text-caption text-dim">
          replay with alternative
          <select
            value={candidateId ?? data.candidate_id ?? ''}
            onChange={(e) => setCandidateId(e.target.value)}
            className="rounded border border-line-strong bg-bg px-2 py-1 text-caption text-ink focus:border-ink"
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.description} ({c.score})
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="panel">
        <span className="eyebrow mb-2 block">Observed vs simulated risk</span>
        <RiskChart
          original={data.original_trajectory || []}
          simulated={data.simulated_trajectory || []}
          placementIndex={placementIndex}
        />
        <p className="mt-2 text-caption">
          <span className="font-mono">{data.risk_transition}</span>
          {data.overall_stability_delta != null && (
            <span className="ml-3 font-mono text-ok">
              {data.overall_stability_delta > 0 ? '+' : ''}
              {data.overall_stability_delta} stability
            </span>
          )}
        </p>
      </div>

      {data.comparison_caveat && (
        <p className="border-l-2 border-line-strong pl-2.5 text-label text-mute">{data.comparison_caveat}</p>
      )}

      {(data.limitations || []).length > 0 && (
        <details className="text-label text-mute">
          <summary className="cursor-pointer">limitations ({data.limitations.length})</summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {data.limitations.map((l, i) => (
              <li key={i}>· {l}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
