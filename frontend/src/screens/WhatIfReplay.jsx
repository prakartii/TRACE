import { useEffect, useState, useMemo, useCallback } from 'react'
import { ArrowLeft, RotateCcw } from 'lucide-react'
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
// silently substituted into the display. #73 (carton overhang past the pallet
// deck) is the clearest end-to-end demo: the recorded overhang is scored High
// and a feasible inward-shift alternative measurably corrects it.
const CANONICAL_DEMO = { eventId: 73, label: 'Event #73 — carton overhang' }

// Structural/conformance scenarios the backend will actually simulate
// (mirrors backend/planner/actions.py::WHAT_IF_ELIGIBLE_SCENARIOS). Worker-
// positioning and environmental-zone incidents are deliberately refused, so
// the screen defaults to — and highlights — the events that can be simulated.
const WHATIF_ELIGIBLE = new Set([
  'heavy_on_light_stacking',
  'pallet_overhang',
  'box_overhang',
  'unsupported_bending_placement',
  'wrong_product_orientation',
  'image_space_support_hypothesis',
])

const isEligible = (ev) => !!ev && WHATIF_ELIGIBLE.has(ev.scenario)

function pickDefaultEvent(events, preferVideoId = null) {
  if (!events?.length) return null
  const pool = preferVideoId ? events.filter((e) => e.video_id === preferVideoId) : events
  const canonical = !preferVideoId && events.find((e) => e.event_id === CANONICAL_DEMO.eventId && isEligible(e))
  return (
    canonical ||
    pool.find(isEligible) ||
    events.find(isEligible) ||
    pool[0] ||
    events[0] ||
    null
  )
}

const DASH = '—'
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : DASH)
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : DASH)

const BAND_TEXT = {
  Low: 'text-ok',
  Medium: 'text-signal',
  High: 'text-danger',
  Critical: 'text-danger',
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
      const def = pickDefaultEvent(evList)
      if (def) {
        setSelectedEventId(def.event_id)
        setSelectedVideoId(def.video_id)
        setTargetTimestamp(def.timestamp || 0)
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
  const incidentTitle = activeEvent ? resolveIncidentTitle(activeEvent) : 'What-if trajectory simulation'
  const demoAvailable = recentEvents.some((e) => e.event_id === CANONICAL_DEMO.eventId)

  const available = !!simulation?.simulation_available
  const origPoints = simulation?.original_trajectory || []
  const simPoints = simulation?.simulated_trajectory || []
  const origK = placementPoint(origPoints)
  const simK = placementPoint(simPoints)

  const candidates = simulation?.available_candidates || []
  const activeCandidate =
    candidates.find((c) => c.id === selectedCandidateId) || candidates[0] || null
  const activeFeasible = !activeCandidate || (activeCandidate.feasibility && activeCandidate.hard_constraints_passed)
  const gain = typeof simulation?.stability_gain_at_placement === 'number'
    ? simulation.stability_gain_at_placement
    : null
  // "No measurable change" is an honest outcome, not a success — surfaced when
  // the alternative barely moves the geometric score at the intervention frame.
  const negligibleChange = available && gain != null && Math.abs(gain) < 1

  const loadCanonicalDemo = () => {
    setSelectedEventId(CANONICAL_DEMO.eventId)
    setSelectedCandidateId(null)
  }

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
    <div className="flex flex-col gap-8 pb-12">
      {/* header */}
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigateTo('Incident Replay')}
            className="inline-flex items-center gap-1 text-small font-medium text-ink-soft hover:text-ink"
          >
            <ArrowLeft size={14} />
            return to incident replay
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="font-display text-display-lg font-semibold text-ink">
              What-if trajectory simulation
            </h1>
            <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-medium uppercase tracking-wider text-ok">
              decision support
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-body text-ink-soft">
            TRACE re-scores an alternative cargo placement across the recorded sequence. This is an
            image-space geometric comparison, not a physical dynamics simulation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {demoAvailable && (
            <button
              type="button"
              onClick={loadCanonicalDemo}
              className="border border-signal/50 bg-signal/10 px-3.5 py-2 text-small font-semibold text-[#8a5f00] transition-colors hover:bg-signal/20"
            >
              load {CANONICAL_DEMO.label}
            </button>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => fetchSimulation(selectedCandidateId)}
            className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2 text-small font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin motion-reduce:animate-none border-2 border-paper border-t-transparent" />
            ) : (
              <RotateCcw size={15} />
            )}
            {loading ? 're-simulating…' : 're-run model'}
          </button>
        </div>
      </section>

      {/* source bar */}
      <section className="grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-3">
        <Field label="camera / zone source">
          <select
            value={selectedVideoId}
            onChange={(e) => {
              const vid = e.target.value
              setSelectedVideoId(vid)
              // Prefer a simulatable incident from the chosen source rather
              // than dropping straight into manual-timestamp mode.
              const ev = pickDefaultEvent(recentEvents, vid)
              if (ev && ev.video_id === vid) {
                setSelectedEventId(ev.event_id)
                setTargetTimestamp(ev.timestamp || 0)
              } else {
                setSelectedEventId(null)
              }
            }}
            className="border border-line bg-surface px-2.5 py-1.5 text-small text-ink focus:border-ink"
          >
            <option value="">select a source…</option>
            {videos.map((v) => {
              const info = getVideoScenarioInfo(v.id || v.filename)
              return (
                <option key={v.id} value={v.id}>
                  {info.scenarioTitle} — {info.cameraName}
                </option>
              )
            })}
          </select>
        </Field>
        <Field label="selected incident">
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
            className="border border-line bg-surface px-2.5 py-1.5 text-small text-ink focus:border-ink"
          >
            <option value="">manual timestamp mode (needs a structural incident)…</option>
            {recentEvents.map((ev) => (
              <option key={ev.event_id} value={ev.event_id}>
                {isEligible(ev) ? '' : '⚠ '}event #{ev.event_id} ({formatTimestamp(ev.timestamp)}) — {resolveIncidentTitle(ev)}
                {isEligible(ev) ? '' : ' [not simulatable]'}
              </option>
            ))}
          </select>
          <span className="text-caption text-ink-faint">
            ⚠ = worker-positioning / zone incident — what-if applies to cargo placement only.
            Manual mode needs a recorded structural incident for context.
          </span>
        </Field>
        <Field label="intervention moment">
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.5"
              min="0"
              value={targetTimestamp}
              disabled={!!selectedEventId}
              onChange={(e) => setTargetTimestamp(parseFloat(e.target.value) || 0)}
              className="w-28 border border-line bg-surface px-2.5 py-1.5 font-mono text-small tabular-nums text-ink focus:border-ink disabled:opacity-60"
            />
            <span className="font-mono text-caption tabular-nums text-ink-faint">
              {simulation?.intervention_timestamp != null
                ? `used t = ${formatTimestamp(simulation.intervention_timestamp)}`
                : `(${formatTimestamp(targetTimestamp)})`}
            </span>
          </div>
        </Field>
      </section>

      {error && (
        <div className="border border-danger bg-danger/5 p-4 font-mono text-caption text-danger">
          [simulation error] {error}
        </div>
      )}

      {loading && !simulation && (
        <div className="border border-line bg-surface p-6 text-small text-ink-soft">Running simulation…</div>
      )}

      {/* refusal notice */}
      {simulation && !available && (
        <div className="border border-signal/40 bg-signal/5 p-5">
          <h2 className="font-mono text-title font-semibold text-[#8a5f00]">what-if not applicable</h2>
          <p className="mt-1 text-small text-ink-soft">
            {simulation.simulation_notice ||
              'This incident cannot be simulated as a cargo placement counterfactual.'}
          </p>
          {simulation.limitations?.length > 0 && (
            <p className="mt-2 font-mono text-caption text-ink-faint">
              {simulation.limitations.join(' · ')}
            </p>
          )}
          {demoAvailable && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-line bg-surface p-3.5">
              <p className="text-caption text-ink-soft">
                Monocular perception does not support physical biomechanics simulation for worker or
                environmental zone hazards.
              </p>
              <button
                type="button"
                onClick={loadCanonicalDemo}
                className="bg-ink px-3.5 py-1.5 text-caption font-semibold text-paper transition-colors hover:bg-ink-soft"
              >
                view valid what-if ({CANONICAL_DEMO.label})
              </button>
            </div>
          )}
        </div>
      )}

      {/* active simulation */}
      {simulation && available && (
        <div className="flex flex-col gap-8">
          {simulation.confidence === 'low' && (
            <div className="border border-signal/40 bg-signal/5 p-3 text-caption text-[#8a5f00]">
              <span className="font-semibold">low confidence:</span> only {origPoints.length} usable
              frame{origPoints.length === 1 ? '' : 's'} where the same cargo track is continuously
              visible. Treat the curve shape as indicative only.
            </div>
          )}

          {/* step 1 — observed state */}
          <section className="border border-danger/40 bg-surface">
            <div className="h-1 bg-danger" />
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="font-mono text-caption font-semibold text-danger">
                step 1 · the observed state
              </span>
              <div className="flex items-center gap-2 text-caption text-ink-soft">
                <span>location: <span className="font-medium text-ink">{videoInfo.cameraName}</span></span>
                <span>·</span>
                <span className="font-mono font-medium tabular-nums text-ink">
                  t = {formatTimestamp(simulation.intervention_timestamp)}
                </span>
              </div>
            </div>
            <div className="p-5">
              <h2 className="font-display text-display-md font-semibold text-ink">{incidentTitle}</h2>

              <div className="mt-4 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-3">
                <Metric
                  label="support coverage"
                  value={pct(origK?.breakdown?.support_alignment)}
                  hint="horizontal footprint overlap with deck"
                />
                <Metric
                  label="overhang penalty"
                  value={pct(origK?.breakdown?.overhang_penalty)}
                  hint="protrusion past the support edge"
                />
                <Metric
                  label="observed stability"
                  value={origK ? `${num(origK.stability_score)} / 100` : DASH}
                  hint={origK ? `band: ${origK.band}` : 'no detection at this frame'}
                />
              </div>

              {(activeEvent?.explanation || scenarioConfig?.whyItMatters) && (
                <div className="mt-3 border-l-2 border-danger bg-danger/5 px-3 py-2 text-small text-ink">
                  <span className="font-medium">why it matters:</span>{' '}
                  {humanizeExplanation(
                    activeEvent?.explanation || scenarioConfig.whyItMatters || '',
                    activeEvent?.scenario,
                    activeEvent?.entity_id,
                  )}
                </div>
              )}
            </div>
          </section>

          {/* step 2 — alternatives */}
          <section className="border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="font-mono text-caption font-semibold text-ink">
                step 2 · alternative placements ({candidates.length})
              </span>
              <span className="text-caption text-ink-faint">click one to re-score the trajectory</span>
            </div>

            {candidates.length === 0 ? (
              <p className="p-5 text-small text-ink-soft">
                No feasible alternative placement was generated for this frame.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-px bg-line md:grid-cols-3">
                {candidates.map((c, i) => {
                  const isSelected = activeCandidate?.id === c.id
                  const feasible = c.feasibility && c.hard_constraints_passed
                  const rank = candidates
                    .filter((x) => x.feasibility && x.hard_constraints_passed)
                    .indexOf(c)
                  const badge = !feasible
                    ? { text: 'not feasible', cls: 'bg-signal/15 text-[#8a5f00]' }
                    : rank === 0
                      ? { text: 'best geometric score', cls: 'bg-ok text-paper' }
                      : { text: `alternative ${rank + 1}`, cls: 'bg-steel text-paper' }
                  return (
                    <button
                      key={c.id || i}
                      type="button"
                      onClick={() => {
                        setSelectedCandidateId(c.id)
                        fetchSimulation(c.id)
                      }}
                      className={`flex flex-col gap-2 p-4 text-left transition-colors ${
                        isSelected ? 'bg-ok/5' : 'bg-surface hover:bg-paper'
                      }`}
                    >
                      <span className={`self-start px-2 py-0.5 text-label font-medium ${badge.cls}`}>
                        {badge.text}
                      </span>
                      <h3 className="text-small font-semibold leading-snug text-ink">
                        {c.description || c.id}
                      </h3>
                      <div className="mt-auto flex items-baseline justify-between border-t border-line pt-2">
                        <span className="text-caption text-ink-soft">candidate score</span>
                        <div className="flex items-baseline gap-1.5">
                          <span className={`font-mono text-title font-semibold tabular-nums ${BAND_TEXT[c.band] || 'text-ink'}`}>
                            {num(c.score)} / 100
                          </span>
                          {typeof c.score_delta === 'number' && (
                            <span className="border border-line bg-paper px-1 py-0.5 font-mono text-label font-medium text-ink-soft">
                              {c.score_delta >= 0 ? '+' : ''}
                              {num(c.score_delta, 1)}
                            </span>
                          )}
                        </div>
                      </div>
                      {!feasible && c.limitations?.length > 0 && (
                        <p className="text-caption leading-snug text-[#8a5f00]">
                          {c.limitations.filter((l) => !l.startsWith('This score')).slice(0, 2).join(' ')}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* step 3 — predicted outcome for the selected candidate */}
          <section className={`border bg-surface ${!activeFeasible ? 'border-signal/40' : negligibleChange ? 'border-line' : 'border-ok/40'}`}>
            <div className={`h-1 ${!activeFeasible ? 'bg-signal' : negligibleChange ? 'bg-line-strong' : 'bg-ok'}`} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className={`font-mono text-caption font-semibold ${!activeFeasible ? 'text-[#8a5f00]' : negligibleChange ? 'text-ink-soft' : 'text-ok'}`}>
                step 3 · {!activeFeasible ? 'this alternative is not feasible' : negligibleChange ? 'no measurable stability change' : 'predicted outcome'} — {activeCandidate?.description || simulation.candidate_label}
              </span>
            </div>
            <div className="p-5">
              {!activeFeasible && (
                <div className="mb-4 border-l-2 border-signal bg-signal/5 px-3 py-2 text-small text-[#8a5f00]">
                  <span className="font-medium">Not a recommendation.</span> This placement fails a
                  physical / boundary constraint
                  {activeCandidate?.limitations?.length
                    ? `: ${activeCandidate.limitations.filter((l) => !l.startsWith('This score')).slice(0, 2).join(' ')}`
                    : '.'}{' '}
                  The scores below are shown for comparison only.
                </div>
              )}
              {activeFeasible && negligibleChange && (
                <div className="mb-4 border-l-2 border-line-strong bg-paper px-3 py-2 text-small text-ink-soft">
                  This alternative does not measurably change the geometric stability score at the
                  intervention frame ({gain >= 0 ? '+' : ''}{num(gain, 1)} pts). The recommended
                  action still applies as a {activeEvent?.scenario === 'wrong_product_orientation' ? 'conformance' : 'placement'} correction.
                </div>
              )}
              <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-3">
                <BeforeAfter label="stability" before={origK?.stability_score} after={simK?.stability_score} suffix=" / 100" />
                <BeforeAfter label="overhang penalty" before={origK?.breakdown?.overhang_penalty} after={simK?.breakdown?.overhang_penalty} suffix="%" />
                <BeforeAfter label="support coverage" before={origK?.breakdown?.support_alignment} after={simK?.breakdown?.support_alignment} suffix="%" />
              </div>

              <div className="mt-4 text-small text-ink-soft">
                <span className="font-mono">{simulation.risk_transition}</span>
                {gain != null && (
                  <span className={`ml-2 font-semibold ${activeFeasible && !negligibleChange ? 'text-ok' : 'text-ink-soft'}`}>
                    ({gain >= 0 ? '+' : ''}
                    {num(gain, 1)} pts at the intervention frame)
                  </span>
                )}
              </div>

              {/* chart — backend series, plotted verbatim */}
              {chart && (
                <div className="mt-4 border border-line bg-paper p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                    <div>
                      <h3 className="text-small font-semibold text-ink">stability trajectory over time</h3>
                      <span className="font-mono text-caption tabular-nums text-ink-faint">
                        [{chart.minT.toFixed(1)}s – {chart.maxT.toFixed(1)}s] · {origPoints.length} frame
                        {origPoints.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <Legend color="bg-danger" label="observed" />
                      <Legend color="bg-ok" label="counterfactual" />
                    </div>
                  </div>

                  <div className="relative overflow-x-auto">
                    <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="max-h-60 w-full select-none">
                      <rect x={chart.padX} y={chart.sy(40)} width={chart.plotW} height={chart.sy(0) - chart.sy(40)} fill="#f3e0da" opacity="0.5" />
                      <rect x={chart.padX} y={chart.sy(60)} width={chart.plotW} height={chart.sy(40) - chart.sy(60)} fill="#f2e6cc" opacity="0.4" />
                      <rect x={chart.padX} y={chart.sy(100)} width={chart.plotW} height={chart.sy(60) - chart.sy(100)} fill="#dce7db" opacity="0.4" />

                      <path d={chart.origPath} fill="none" stroke="#B23A22" strokeWidth="2" strokeDasharray="4,2" />
                      <path d={chart.simPath} fill="none" stroke="#3F6E4C" strokeWidth="2.5" />

                      {chart.o.map((c, idx) => (
                        <circle
                          key={`o-${idx}`}
                          cx={c.x}
                          cy={c.y}
                          r={hoveredIdx === idx ? 5 : 3.5}
                          fill="#B23A22"
                          stroke="#F6F2E9"
                          strokeWidth="1.5"
                          className="cursor-pointer"
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
                          fill="#3F6E4C"
                          stroke="#F6F2E9"
                          strokeWidth="1.5"
                          className="cursor-pointer"
                          onMouseEnter={() => setHoveredIdx(idx)}
                          onMouseLeave={() => setHoveredIdx(null)}
                        />
                      ))}
                    </svg>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border border-line bg-surface p-2.5">
                    {hoveredOrig ? (
                      <div className="flex flex-wrap items-center gap-3 font-mono text-caption tabular-nums">
                        <span className="font-medium text-ink">t = {formatTimestamp(hoveredOrig.t)}</span>
                        <span className="text-danger">observed: {num(hoveredOrig.score, 1)}</span>
                        {hoveredSim && (
                          <>
                            <span>→</span>
                            <span className="font-medium text-ok">counterfactual: {num(hoveredSim.score, 1)}</span>
                            <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 font-medium text-ok">
                              Δ {hoveredSim.score - hoveredOrig.score >= 0 ? '+' : ''}
                              {num(hoveredSim.score - hoveredOrig.score, 1)}
                            </span>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-caption italic text-ink-faint">
                        Hover a point to inspect per-frame stability.
                      </span>
                    )}
                  </div>

                  {simulation.comparison_caveat && (
                    <p className="mt-2 border-l-2 border-line-strong pl-2 text-caption leading-relaxed text-ink-faint">
                      {simulation.comparison_caveat}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* technical disclosure */}
          <section className="border border-line bg-surface">
            <button
              type="button"
              onClick={() => setShowTechnical((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-small font-medium text-ink-soft hover:text-ink"
            >
              <span>model rationale &amp; limitations</span>
              <span className="font-mono text-caption">{showTechnical ? 'collapse' : 'expand'}</span>
            </button>

            {showTechnical && (
              <div className="flex flex-col gap-3 border-t border-line p-4">
                {simulation.explanation && (
                  <div className="border-l-2 border-ok bg-ok/5 p-3 text-small text-ink">
                    {simulation.explanation}
                  </div>
                )}
                {simulation.limitations?.length > 0 && (
                  <ul className="list-inside list-disc space-y-1 border border-line bg-paper p-3 text-caption text-ink-soft">
                    {simulation.limitations.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 bg-surface p-3">
      <span className="text-label font-medium text-ink-faint">{label}</span>
      {children}
    </label>
  )
}

function Legend({ color, label }) {
  return (
    <span className="flex items-center gap-1.5 text-caption text-ink-soft">
      <span className={`h-1 w-4 ${color}`} />
      {label}
    </span>
  )
}

function Metric({ label, value, hint }) {
  return (
    <div className="bg-paper p-3">
      <span className="text-label font-medium text-ink-faint">{label}</span>
      <p className="mt-1 font-display text-display-md font-semibold tabular-nums text-danger">{value}</p>
      <p className="text-caption text-ink-faint">{hint}</p>
    </div>
  )
}

function BeforeAfter({ label, before, after, suffix = '' }) {
  const b = typeof before === 'number' && Number.isFinite(before)
  const a = typeof after === 'number' && Number.isFinite(after)
  return (
    <div className="flex flex-col gap-1 bg-paper p-3">
      <span className="text-label font-medium text-ink-faint">{label}</span>
      <div className="flex items-baseline gap-2 font-mono tabular-nums">
        <span className="text-title font-semibold text-danger line-through">
          {b ? before.toFixed(1) : DASH}
          {b ? suffix : ''}
        </span>
        <span className="text-caption text-ink-faint">→</span>
        <span className="text-display-md font-semibold text-ok">
          {a ? after.toFixed(1) : DASH}
          {a ? suffix : ''}
        </span>
      </div>
      {b && a && (
        <span className="text-caption font-medium text-ok">
          {after - before >= 0 ? '+' : ''}
          {(after - before).toFixed(1)}
          {suffix} change
        </span>
      )}
    </div>
  )
}
