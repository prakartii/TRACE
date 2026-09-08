import { useEffect, useState, useMemo, useCallback } from 'react'
import { listEvents } from '../api/events.js'
import { listVideos } from '../api/videos.js'
import { getEventTrajectory, getTrajectoryWhatIf } from '../api/whatif.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import {
  getScenarioConfig,
  getVideoScenarioInfo,
  resolveIncidentTitle,
  formatTimestamp,
} from '../lib/scenarios.js'
import { humanizeExplanation } from '../lib/format.js'

// A known-good sequence kept as a quick-select. It is only offered when the
// backend actually reports an event with this id — never as a value that gets
// silently substituted into the display.
const CANONICAL_DEMO = { eventId: 73, label: 'Event #73 — Cargo Overhang' }

const DASH = '—'
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : DASH)
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : DASH)

const BAND_TEXT = {
  Low: 'text-emerald-700',
  Medium: 'text-amber-700',
  High: 'text-orange-700',
  Critical: 'text-red-700',
}

function placementPoint(points) {
  if (!points || !points.length) return null
  return points.find((p) => p.is_placement_moment) || points[0]
}

export default function WhatIfReplay() {
  const { replayTarget, navigateTo } = useLiveViewContext()

  const [videos, setVideos] = useState([])
  const [recentEvents, setRecentEvents] = useState([])
  const [selectedVideoId, setSelectedVideoId] = useState(replayTarget?.videoId || '')
  const [selectedEventId, setSelectedEventId] = useState(replayTarget?.eventId || null)
  const [targetTimestamp, setTargetTimestamp] = useState(replayTarget?.timestamp ?? 0)

  const [simulation, setSimulation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState(null)
  const [hoveredIdx, setHoveredIdx] = useState(null)
  const [showTechnical, setShowTechnical] = useState(false)

  // 1. Initial load
  useEffect(() => {
    let active = true
    Promise.all([listVideos(), listEvents({ limit: 40 })]).then(([vidList, evList]) => {
      if (!active) return
      setVideos(vidList || [])
      setRecentEvents(evList || [])
      if (replayTarget?.eventId) return
      if (evList?.length) {
        const first = evList[0]
        setSelectedEventId(first.event_id)
        setSelectedVideoId(first.video_id)
        setTargetTimestamp(first.timestamp || 0)
      }
    })
    return () => {
      active = false
    }
  }, [])

  // Sync when navigated in from Incident Replay
  useEffect(() => {
    if (!replayTarget?.eventId) return
    setSelectedEventId(replayTarget.eventId)
    if (replayTarget.videoId) setSelectedVideoId(replayTarget.videoId)
    if (replayTarget.timestamp != null) setTargetTimestamp(replayTarget.timestamp)
    setSelectedCandidateId(null)
  }, [replayTarget])

  // 2. Run the simulation
  const fetchSimulation = useCallback(
    async (candidateId = null) => {
      if (!selectedEventId && !selectedVideoId) return
      setLoading(true)
      setError(null)
      try {
        const res = selectedEventId
          ? await getEventTrajectory(selectedEventId, candidateId, 'pilot')
          : await getTrajectoryWhatIf({
              videoId: selectedVideoId,
              timestamp: targetTimestamp,
              alternativeCandidate: candidateId,
              model: 'pilot',
            })
        setSimulation(res)
        setSelectedCandidateId(res?.candidate_id && res.candidate_id !== 'none' ? res.candidate_id : null)
      } catch (err) {
        setError(err.message || 'Failed to compute trajectory simulation')
        setSimulation(null)
      } finally {
        setLoading(false)
      }
    },
    [selectedVideoId, selectedEventId, targetTimestamp],
  )

  useEffect(() => {
    if (selectedEventId || selectedVideoId) fetchSimulation(null)
  }, [selectedEventId, selectedVideoId, fetchSimulation])

  const activeEvent = useMemo(
    () => recentEvents.find((e) => e.event_id === selectedEventId) || replayTarget?.event || null,
    [recentEvents, selectedEventId, replayTarget],
  )
  const scenarioConfig = getScenarioConfig(activeEvent?.scenario || simulation?.candidate_label || '')
  const videoInfo = getVideoScenarioInfo(selectedVideoId || activeEvent?.video_id || '')
  const incidentTitle = activeEvent ? resolveIncidentTitle(activeEvent) : 'What-If Trajectory Simulation'
  const demoAvailable = recentEvents.some((e) => e.event_id === CANONICAL_DEMO.eventId)

  const available = !!simulation?.simulation_available
  const origPoints = simulation?.original_trajectory || []
  const simPoints = simulation?.simulated_trajectory || []
  const origK = placementPoint(origPoints)
  const simK = placementPoint(simPoints)

  const candidates = simulation?.available_candidates || []
  const activeCandidate =
    candidates.find((c) => c.id === selectedCandidateId) || candidates[0] || null

  // --- Chart geometry: the two curves are the backend series, verbatim. ---
  const chart = useMemo(() => {
    if (!origPoints.length && !simPoints.length) return null
    const all = [...origPoints, ...simPoints]
    const ts = all.map((p) => p.timestamp)
    const minT = Math.min(...ts)
    const maxT = Math.max(...ts)
    const spanT = Math.max(0.1, maxT - minT)

    const W = 800
    const H = 220
    const padX = 46
    const padY = 22
    const plotW = W - padX * 2
    const plotH = H - padY * 2
    const sx = (t) => padX + ((t - minT) / spanT) * plotW
    const sy = (s) => H - padY - (Math.max(0, Math.min(100, s)) / 100) * plotH

    const toCoords = (pts) =>
      pts.map((p, idx) => ({
        x: sx(p.timestamp),
        y: sy(p.stability_score),
        t: p.timestamp,
        score: p.stability_score,
        band: p.band,
        isMoment: p.is_placement_moment,
        idx,
      }))
    const path = (coords) =>
      coords.reduce((acc, c, i) => (i === 0 ? `M ${c.x},${c.y}` : `${acc} L ${c.x},${c.y}`), '')

    const o = toCoords(origPoints)
    const s = toCoords(simPoints)
    return { W, H, padX, padY, plotW, sy, minT, maxT, o, s, origPath: path(o), simPath: path(s) }
  }, [origPoints, simPoints])

  const hoveredOrig = hoveredIdx != null ? chart?.o?.[hoveredIdx] : null
  const hoveredSim = hoveredIdx != null ? chart?.s?.[hoveredIdx] : null

  return (
    <div className="flex flex-col gap-6 text-ink pb-12 max-w-5xl">
      {/* Header + context switcher */}
      <div className="border border-line bg-white p-5 shadow-sm flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <button
                type="button"
                onClick={() => navigateTo('Incident Replay')}
                className="text-xs font-semibold text-neutral-600 hover:text-neutral-950 underline mr-1"
              >
                ← Return to Incident Replay
              </button>
              <span className="text-neutral-300">|</span>
              <span className="text-base">🔮</span>
              <h1 className="text-lg font-bold tracking-tight text-neutral-900">
                What-If Trajectory Simulation
              </h1>
              <span className="border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                Decision Support
              </span>
            </div>
            <p className="text-xs text-neutral-600 max-w-2xl leading-relaxed">
              TRACE re-scores an alternative cargo placement across the recorded sequence. This is
              an image-space geometric comparison, not a physical dynamics simulation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {demoAvailable && (
              <button
                type="button"
                onClick={() => {
                  setSelectedEventId(CANONICAL_DEMO.eventId)
                  setSelectedCandidateId(null)
                }}
                className="px-3 py-1.5 text-xs font-bold bg-white border border-amber-400 text-amber-900 hover:bg-amber-50"
              >
                Load {CANONICAL_DEMO.label}
              </button>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={() => fetchSimulation(selectedCandidateId)}
              className="border border-neutral-900 bg-neutral-900 hover:bg-neutral-800 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {loading ? 'Re-simulating…' : '↻ Re-run'}
            </button>
          </div>
        </div>

        <div className="border-t border-line pt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Camera / Zone Source</label>
            <select
              value={selectedVideoId}
              onChange={(e) => {
                setSelectedVideoId(e.target.value)
                setSelectedEventId(null)
              }}
              className="border border-line bg-white px-2.5 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500 truncate"
            >
              <option value="">Select a source…</option>
              {videos.map((v) => {
                const info = getVideoScenarioInfo(v.id || v.filename)
                return (
                  <option key={v.id} value={v.id}>
                    {info.scenarioTitle} — {info.cameraName}
                  </option>
                )
              })}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Selected Incident</label>
            <select
              value={selectedEventId || ''}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null
                setSelectedEventId(val)
                const ev = recentEvents.find((x) => x.event_id === val)
                if (ev) {
                  setSelectedVideoId(ev.video_id)
                  setTargetTimestamp(ev.timestamp)
                }
              }}
              className="border border-line bg-white px-2.5 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500 truncate"
            >
              <option value="">Manual timestamp mode…</option>
              {recentEvents.map((ev) => (
                <option key={ev.event_id} value={ev.event_id}>
                  #{ev.event_id} ({formatTimestamp(ev.timestamp)}) — {resolveIncidentTitle(ev)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Intervention Moment</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                min="0"
                value={targetTimestamp}
                disabled={!!selectedEventId}
                onChange={(e) => setTargetTimestamp(parseFloat(e.target.value) || 0)}
                className="border border-line bg-white px-2.5 py-1 text-xs font-mono tabular-nums text-neutral-800 w-28 focus:outline-none focus:border-neutral-500 disabled:bg-neutral-100"
              />
              <span className="font-mono tabular-nums text-xs text-neutral-500">
                {simulation?.intervention_timestamp != null
                  ? `used t = ${formatTimestamp(simulation.intervention_timestamp)}`
                  : formatTimestamp(targetTimestamp)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-red-300 bg-red-50 p-4 text-xs text-red-800 font-mono">
          <strong>[SIMULATION ERROR]</strong> {error}
        </div>
      )}

      {loading && !simulation && (
        <div className="border border-line bg-white p-6 text-xs text-neutral-500">Running simulation…</div>
      )}

      {/* Refusal notice */}
      {simulation && !available && (
        <div className="border-2 border-amber-400 bg-amber-50 p-5 flex flex-col gap-3 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-bold uppercase tracking-wider text-amber-900 font-mono">
                What-If not available
              </h2>
              <p className="text-xs text-amber-900 leading-relaxed">
                {simulation.simulation_notice || 'This incident cannot be simulated as a cargo placement counterfactual.'}
              </p>
              {simulation.limitations?.length > 0 && (
                <p className="text-[11px] text-amber-800 font-mono mt-1">
                  {simulation.limitations.join(' · ')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Active simulation */}
      {simulation && available && (
        <div className="flex flex-col gap-6">
          {simulation.confidence === 'low' && (
            <div className="border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900">
              <strong>Low confidence:</strong> only {origPoints.length} usable frame
              {origPoints.length === 1 ? '' : 's'} where the same cargo track is continuously
              visible. Treat the curve shape as indicative only.
            </div>
          )}

          {/* STEP 1 — Observed state */}
          <div className="border-2 border-red-500 bg-white p-5 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-red-200 pb-2.5 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="bg-red-600 text-white text-[10px] font-bold uppercase px-2 py-0.5 tracking-wider">Step 1</span>
                <h2 className="text-sm font-bold uppercase tracking-wider text-red-950">Observed state at the intervention frame</h2>
              </div>
              <div className="flex items-center gap-2 text-xs text-neutral-600">
                <span>Location: <strong className="text-neutral-900">{videoInfo.cameraName}</strong></span>
                <span className="text-neutral-300">·</span>
                <span className="font-mono tabular-nums font-bold text-neutral-900">
                  t = {formatTimestamp(simulation.intervention_timestamp)}
                </span>
              </div>
            </div>

            <div className="text-sm font-bold text-neutral-950">{incidentTitle}</div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <Metric label="Support Coverage" value={pct(origK?.breakdown?.support_alignment)} hint="Horizontal footprint overlap with deck" tone="red" />
              <Metric label="Overhang Penalty" value={pct(origK?.breakdown?.overhang_penalty)} hint="Protrusion past the support edge" tone="red" />
              <Metric
                label="Observed Stability"
                value={origK ? `${num(origK.stability_score)} / 100` : DASH}
                hint={origK ? `Band: ${origK.band}` : 'No detection at this frame'}
                tone="red"
              />
            </div>

            {(activeEvent?.explanation || scenarioConfig?.whyItMatters) && (
              <div className="bg-red-50/90 border-l-2 border-red-600 p-2.5 text-xs text-red-950 leading-relaxed">
                <strong>Why it matters:</strong>{' '}
                {humanizeExplanation(
                  activeEvent?.explanation || scenarioConfig.whyItMatters || '',
                  activeEvent?.scenario,
                  activeEvent?.entity_id,
                )}
              </div>
            )}
          </div>

          {/* STEP 2 — Alternatives */}
          <div className="border-2 border-neutral-900 bg-white p-5 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-line pb-2.5 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="bg-neutral-900 text-white text-[10px] font-bold uppercase px-2 py-0.5 tracking-wider">Step 2</span>
                <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-950">
                  Alternative placements ({candidates.length})
                </h2>
              </div>
              <span className="text-[11px] text-neutral-500">Click one to re-score the trajectory</span>
            </div>

            {candidates.length === 0 ? (
              <p className="text-xs text-neutral-500">No feasible alternative placement was generated for this frame.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1">
                {candidates.map((c, i) => {
                  const isSelected = activeCandidate?.id === c.id
                  const feasible = c.feasibility && c.hard_constraints_passed
                  const rank = candidates.filter((x) => x.feasibility && x.hard_constraints_passed).indexOf(c)
                  const badge = !feasible
                    ? { text: 'Not feasible', cls: 'border-amber-400 bg-amber-50 text-amber-900' }
                    : rank === 0
                      ? { text: 'Best geometric score', cls: 'border-emerald-500 bg-emerald-100 text-emerald-900' }
                      : { text: `Alternative ${rank + 1}`, cls: 'border-blue-400 bg-blue-50 text-blue-900' }
                  return (
                    <button
                      key={c.id || i}
                      type="button"
                      onClick={() => {
                        setSelectedCandidateId(c.id)
                        fetchSimulation(c.id)
                      }}
                      className={`text-left p-4 border transition-all flex flex-col gap-2 ${
                        isSelected ? 'border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-600' : 'border-line bg-paper hover:border-neutral-500'
                      }`}
                    >
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 border self-start ${badge.cls}`}>{badge.text}</span>
                      <h3 className="text-xs font-bold text-neutral-950 leading-snug">{c.description || c.id}</h3>
                      <div className="border-t border-line/60 pt-2 flex items-baseline justify-between text-xs">
                        <span className="text-[10px] uppercase font-bold text-neutral-500">Candidate score</span>
                        <div className="flex items-baseline gap-1.5">
                          <span className={`text-sm font-bold font-mono ${BAND_TEXT[c.band] || 'text-neutral-800'}`}>
                            {num(c.score)} / 100
                          </span>
                          {typeof c.score_delta === 'number' && (
                            <span className="text-[11px] font-bold font-mono text-neutral-600 bg-neutral-100 px-1 py-0.5 border border-neutral-300">
                              {c.score_delta >= 0 ? '+' : ''}{num(c.score_delta, 1)}
                            </span>
                          )}
                        </div>
                      </div>
                      {!feasible && c.limitations?.length > 0 && (
                        <p className="text-[10px] text-amber-800 leading-snug">
                          {c.limitations.filter((l) => !l.startsWith('This score')).slice(0, 2).join(' ')}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* STEP 3 — Predicted outcome for the selected candidate */}
          <div className="border-2 border-emerald-600 bg-white p-5 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-emerald-200 pb-2.5 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="bg-emerald-600 text-white text-[10px] font-bold uppercase px-2 py-0.5 tracking-wider">Step 3</span>
                <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-950">
                  Predicted outcome — {activeCandidate?.description || simulation.candidate_label}
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <BeforeAfter label="Stability" before={origK?.stability_score} after={simK?.stability_score} suffix=" / 100" />
              <BeforeAfter label="Overhang penalty" before={origK?.breakdown?.overhang_penalty} after={simK?.breakdown?.overhang_penalty} suffix="%" />
              <BeforeAfter label="Support coverage" before={origK?.breakdown?.support_alignment} after={simK?.breakdown?.support_alignment} suffix="%" />
            </div>

            <div className="text-xs text-neutral-700">
              <span className="font-mono">{simulation.risk_transition}</span>
              {typeof simulation.stability_gain_at_placement === 'number' && (
                <span className="ml-2 font-bold text-emerald-800">
                  ({simulation.stability_gain_at_placement >= 0 ? '+' : ''}
                  {num(simulation.stability_gain_at_placement, 1)} pts at the intervention frame)
                </span>
              )}
            </div>

            {/* Chart — backend series, plotted verbatim */}
            {chart && (
              <div className="border border-line bg-white p-4 shadow-xs flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-line pb-2 flex-wrap gap-2">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-900">Stability trajectory over time</h3>
                    <span className="text-[11px] text-neutral-500 font-mono tabular-nums">
                      {chart.minT.toFixed(1)}s – {chart.maxT.toFixed(1)}s · {origPoints.length} frame{origPoints.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-500 inline-block" /> Observed</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-600 inline-block" /> Counterfactual</span>
                  </div>
                </div>

                <div className="relative overflow-x-auto">
                  <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full h-auto max-h-60 select-none">
                    <rect x={chart.padX} y={chart.sy(40)} width={chart.plotW} height={chart.sy(0) - chart.sy(40)} fill="#fef2f2" opacity="0.5" />
                    <rect x={chart.padX} y={chart.sy(60)} width={chart.plotW} height={chart.sy(40) - chart.sy(60)} fill="#fffbeb" opacity="0.4" />
                    <rect x={chart.padX} y={chart.sy(100)} width={chart.plotW} height={chart.sy(60) - chart.sy(100)} fill="#f0fdf4" opacity="0.4" />

                    <path d={chart.origPath} fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="4,2" />
                    <path d={chart.simPath} fill="none" stroke="#10b981" strokeWidth="2.5" />

                    {chart.o.map((c, idx) => (
                      <circle
                        key={`o-${idx}`}
                        cx={c.x}
                        cy={c.y}
                        r={hoveredIdx === idx ? 5 : 3.5}
                        fill="#ef4444"
                        stroke="#fff"
                        strokeWidth="1.5"
                        onMouseEnter={() => setHoveredIdx(idx)}
                        onMouseLeave={() => setHoveredIdx(null)}
                      />
                    ))}
                    {chart.s.map((c, idx) => (
                      <circle
                        key={`s-${idx}`}
                        cx={c.x}
                        cy={c.y}
                        r={hoveredIdx === idx ? 5 : 4}
                        fill="#10b981"
                        stroke="#fff"
                        strokeWidth="1.5"
                        onMouseEnter={() => setHoveredIdx(idx)}
                        onMouseLeave={() => setHoveredIdx(null)}
                      />
                    ))}
                  </svg>
                </div>

                <div className="bg-neutral-50 border border-line p-2.5 text-xs">
                  {hoveredOrig ? (
                    <div className="flex items-center gap-3 flex-wrap font-mono tabular-nums">
                      <span className="font-bold text-neutral-900">t = {formatTimestamp(hoveredOrig.t)}</span>
                      <span className="text-red-700">Observed: {num(hoveredOrig.score, 1)}</span>
                      {hoveredSim && (
                        <>
                          <span>→</span>
                          <span className="text-emerald-800 font-bold">Counterfactual: {num(hoveredSim.score, 1)}</span>
                          <span className="font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 border border-emerald-300">
                            Δ {hoveredSim.score - hoveredOrig.score >= 0 ? '+' : ''}
                            {num(hoveredSim.score - hoveredOrig.score, 1)}
                          </span>
                        </>
                      )}
                    </div>
                  ) : (
                    <span className="text-neutral-500 italic text-[11px]">Hover a point to inspect per-frame stability.</span>
                  )}
                </div>

                {simulation.comparison_caveat && (
                  <p className="text-[11px] text-neutral-500 leading-relaxed border-l-2 border-neutral-300 pl-2">
                    {simulation.comparison_caveat}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Technical disclosure */}
          <div className="border border-line bg-white p-4 shadow-sm flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowTechnical((v) => !v)}
              className="text-xs font-bold text-neutral-700 hover:text-neutral-950 flex items-center justify-between py-1"
            >
              <span>{showTechnical ? '▲ Hide' : '▼ Show'} model rationale &amp; limitations</span>
            </button>
            {showTechnical && (
              <div className="mt-2 flex flex-col gap-3 border-t border-line pt-3 text-xs">
                {simulation.explanation && (
                  <div className="border-l-2 border-emerald-600 bg-emerald-50/60 p-3 text-neutral-900 leading-relaxed">
                    {simulation.explanation}
                  </div>
                )}
                {simulation.limitations?.length > 0 && (
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-neutral-700 bg-neutral-50 border border-neutral-200 p-3">
                    {simulation.limitations.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, hint, tone = 'neutral' }) {
  const border = tone === 'red' ? 'border-red-200 bg-red-50/50' : 'border-line bg-neutral-50'
  const text = tone === 'red' ? 'text-red-700' : 'text-neutral-900'
  return (
    <div className={`border ${border} p-3 flex flex-col gap-1`}>
      <span className="text-[10px] uppercase font-bold text-neutral-500">{label}</span>
      <span className={`text-2xl font-bold font-mono tabular-nums ${text}`}>{value}</span>
      <span className="text-[10px] text-neutral-500">{hint}</span>
    </div>
  )
}

function BeforeAfter({ label, before, after, suffix = '' }) {
  const b = typeof before === 'number' && Number.isFinite(before)
  const a = typeof after === 'number' && Number.isFinite(after)
  return (
    <div className="border border-emerald-300 bg-emerald-50/40 p-3.5 flex flex-col gap-1">
      <span className="text-[10px] uppercase font-bold text-neutral-500">{label}</span>
      <div className="flex items-baseline gap-2 pt-1 font-mono tabular-nums">
        <span className="text-base font-bold text-red-600 line-through">{b ? before.toFixed(1) : DASH}{b ? suffix : ''}</span>
        <span className="text-xs text-neutral-400">→</span>
        <span className="text-2xl font-bold text-emerald-800">{a ? after.toFixed(1) : DASH}{a ? suffix : ''}</span>
      </div>
      {b && a && (
        <span className="text-[10px] text-emerald-900 font-semibold">
          {after - before >= 0 ? '+' : ''}{(after - before).toFixed(1)}{suffix} change
        </span>
      )}
    </div>
  )
}
