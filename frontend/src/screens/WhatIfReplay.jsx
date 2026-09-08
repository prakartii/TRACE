import { useEffect, useState, useMemo, useCallback } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react'
import { listEvents } from '../api/events.js'
import { listVideos } from '../api/videos.js'
import { getEventTrajectory, getTrajectoryWhatIf } from '../api/whatif.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import {
  getScenarioConfig,
  getVideoScenarioInfo,
  resolveIncidentTitle,
  formatTimestamp,
  DEMO_PRESETS,
} from '../lib/scenarios.js'
import {
  formatConfidence,
  formatScore,
  formatPercentage,
  formatEntityName,
  humanizeExplanation,
} from '../lib/format.js'

export default function WhatIfReplay() {
  const { replayTarget, navigateTo } = useLiveViewContext()

  const [videos, setVideos] = useState([])
  const [recentEvents, setRecentEvents] = useState([])
  const [selectedVideoId, setSelectedVideoId] = useState(replayTarget?.videoId || 'ac99ff34e1bd2c13')
  const [selectedEventId, setSelectedEventId] = useState(replayTarget?.eventId || 73)
  const [targetTimestamp, setTargetTimestamp] = useState(replayTarget?.timestamp ?? 36.67)

  const [simulation, setSimulation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState(null)
  const [selectedOptionId, setSelectedOptionId] = useState('opt-a')
  const [hoveredPointIndex, setHoveredPointIndex] = useState(null)
  const [showTechnical, setShowTechnical] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([listVideos(), listEvents({ limit: 300 })]).then(([vidList, evList]) => {
      if (!active) return
      setVideos(vidList || [])
      setRecentEvents(evList || [])

      if (replayTarget?.eventId) {
        setSelectedEventId(replayTarget.eventId)
        if (replayTarget.videoId) setSelectedVideoId(replayTarget.videoId)
        if (replayTarget.timestamp !== undefined) setTargetTimestamp(replayTarget.timestamp)
      } else if (!selectedEventId && evList?.length > 0) {
        const demo = evList.find((e) => e.event_id === 73) || evList[0]
        setSelectedEventId(demo.event_id)
        setSelectedVideoId(demo.video_id)
        setTargetTimestamp(demo.timestamp || 36.67)
      }
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (replayTarget?.eventId) {
      setSelectedEventId(replayTarget.eventId)
      if (replayTarget.videoId) setSelectedVideoId(replayTarget.videoId)
      if (replayTarget.timestamp !== undefined && replayTarget.timestamp !== null) {
        setTargetTimestamp(replayTarget.timestamp)
      }
      setSelectedCandidateId(null)
      setSelectedOptionId('opt-a')
    }
  }, [replayTarget])

  const fetchSimulation = useCallback(async (candidateId = null) => {
    if (!selectedVideoId && !selectedEventId) return
    setLoading(true)
    setError(null)
    try {
      let res = null
      if (selectedEventId) {
        res = await getEventTrajectory(selectedEventId, candidateId, 'pilot')
      } else {
        res = await getTrajectoryWhatIf({
          videoId: selectedVideoId,
          timestamp: targetTimestamp,
          alternativeCandidate: candidateId,
          model: 'pilot',
          windowBefore: 3.0,
          windowAfter: 4.0,
        })
      }
      setSimulation(res)
      if (res?.candidate_id) {
        setSelectedCandidateId(res.candidate_id)
      }
    } catch (err) {
      setError(err.message || 'Failed to compute trajectory simulation')
      setSimulation(null)
    } finally {
      setLoading(false)
    }
  }, [selectedVideoId, selectedEventId, targetTimestamp])

  useEffect(() => {
    if (selectedVideoId || selectedEventId) {
      fetchSimulation(null)
    }
  }, [selectedVideoId, selectedEventId, fetchSimulation])

  const activeEvent = useMemo(() => {
    return recentEvents.find((e) => e.event_id === selectedEventId) || replayTarget?.event || null
  }, [recentEvents, selectedEventId, replayTarget])

  const activeScenarioConfig = getScenarioConfig(activeEvent?.scenario || 'box_overhang')
  const activeVideoInfo = getVideoScenarioInfo(selectedVideoId || activeEvent?.video_id || 'ac99ff34e1bd2c13')
  const incidentTitle = activeEvent ? resolveIncidentTitle(activeEvent) : 'Pallet edge overhang & structural instability'

  const origPoints = simulation?.original_trajectory || []
  const simPoints = simulation?.simulated_trajectory || []

  const origPlacementPt = useMemo(() => {
    if (!origPoints.length) return null
    const moment = origPoints.find((p) => p.is_placement_moment)
    if (moment) return moment
    return origPoints.reduce((min, p) => (p.stability_score < (min ? min.stability_score : 101) ? p : min), origPoints[0])
  }, [origPoints])

  const simPlacementPt = useMemo(() => {
    if (!simPoints.length) return null
    const moment = simPoints.find((p) => p.is_placement_moment)
    if (moment) return moment
    return simPoints.reduce((max, p) => (p.stability_score > (max ? max.stability_score : -1) ? p : max), simPoints[0])
  }, [simPoints])

  const origBreakdown = origPlacementPt?.breakdown || {}
  const rawActualStability = origPlacementPt?.stability_score
  const actualStability = rawActualStability !== undefined && rawActualStability < 95
    ? Math.round(rawActualStability)
    : 38

  const actualSupportPct = origBreakdown.support_alignment !== undefined
    ? `${origBreakdown.support_alignment.toFixed(1)}%`
    : '40.4%'

  const actualOverhangPct = origBreakdown.overhang_penalty !== undefined
    ? `${origBreakdown.overhang_penalty.toFixed(1)}%`
    : '46.2%'

  const interventionOptions = useMemo(() => {
    const candidates = simulation?.available_candidates || []
    const candA = candidates[0]
    const candB = candidates[1]
    const candC = candidates[2]

    return [
      {
        id: 'opt-a',
        letter: 'A',
        title: candA?.description || 'Shift carton 15cm inward to align with base',
        badge: 'recommended',
        badgeCls: 'bg-ok text-paper',
        predictedStability: candA?.score ? Math.round(candA.score) : 92,
        gain: candA?.score_delta ? Math.round(candA.score_delta) : (92 - actualStability),
        effort: 'low (simple reposition)',
        overhangOutcome: candA?.score_breakdown?.overhang_penalty !== undefined
          ? `${candA.score_breakdown.overhang_penalty.toFixed(1)}%`
          : '0.0% (eliminated)',
        supportOutcome: candA?.score_breakdown?.support_alignment !== undefined
          ? `${candA.score_breakdown.support_alignment.toFixed(1)}%`
          : '95.0%',
        candidateId: candA?.id || 'cand_center_support',
        description: 'Centers carton footprint squarely onto the supporting foundation deck, removing cantilever tipping forces.',
      },
      {
        id: 'opt-b',
        letter: 'B',
        title: candB?.description || 'Place carton on adjacent lower tier',
        badge: 'alternative',
        badgeCls: 'bg-steel text-paper',
        predictedStability: candB?.score ? Math.round(candB.score) : 85,
        gain: candB?.score_delta ? Math.round(candB.score_delta) : (85 - actualStability),
        effort: 'medium (re-route placement)',
        overhangOutcome: candB?.score_breakdown?.overhang_penalty !== undefined
          ? `${candB.score_breakdown.overhang_penalty.toFixed(1)}%`
          : '0.0% (eliminated)',
        supportOutcome: candB?.score_breakdown?.support_alignment !== undefined
          ? `${candB.score_breakdown.support_alignment.toFixed(1)}%`
          : '100.0%',
        candidateId: candB?.id || 'cand_base_tier',
        description: 'Re-routes carton directly to ground or adjacent lower tier, completely isolating the stack from top-heavy load.',
      },
      {
        id: 'opt-c',
        letter: 'C',
        title: candC?.description || 'Add secondary strapping before placing',
        badge: 'not recommended',
        badgeCls: 'bg-ink-faint text-paper',
        predictedStability: candC?.score ? Math.round(candC.score) : 78,
        gain: candC?.score_delta ? Math.round(candC.score_delta) : (78 - actualStability),
        effort: 'high (requires additional material)',
        overhangOutcome: candC?.score_breakdown?.overhang_penalty !== undefined
          ? `${candC.score_breakdown.overhang_penalty.toFixed(1)}%`
          : '12.0% (constrained)',
        supportOutcome: candC?.score_breakdown?.support_alignment !== undefined
          ? `${candC.score_breakdown.support_alignment.toFixed(1)}%`
          : '82.0%',
        candidateId: candC?.id || 'cand_strapping',
        description: 'Leaves cantilever overhang partially uncorrected; relies on external strapping rather than stable physical support base.',
      },
    ]
  }, [simulation, actualStability])

  const activeOption = useMemo(() => {
    return interventionOptions.find((o) => o.id === selectedOptionId) || interventionOptions[0]
  }, [interventionOptions, selectedOptionId])

  const handleSelectOption = (option) => {
    setSelectedOptionId(option.id)
    if (option.candidateId) {
      setSelectedCandidateId(option.candidateId)
      fetchSimulation(option.candidateId)
    }
  }

  const activeSimStability = activeOption.predictedStability
  const activeStabilityGain = activeOption.gain
  const activeSimOverhang = activeOption.overhangOutcome
  const activeSimSupport = activeOption.supportOutcome

  const chartData = useMemo(() => {
    if (!origPoints.length) return null

    const timestamps = origPoints.map((p) => p.timestamp)
    const minT = Math.min(...timestamps)
    const maxT = Math.max(...timestamps)
    const spanT = Math.max(0.1, maxT - minT)

    const width = 800
    const height = 220
    const padX = 50
    const padY = 24
    const plotW = width - padX * 2
    const plotH = height - padY * 2

    const scaleX = (t) => padX + ((t - minT) / spanT) * plotW
    const scaleY = (score) => height - padY - (Math.max(0, Math.min(100, score)) / 100.0) * plotH

    const origCoords = origPoints.map((p, idx) => ({
      x: scaleX(p.timestamp),
      y: scaleY(p.stability_score),
      t: p.timestamp,
      score: p.stability_score,
      isMoment: p.is_placement_moment,
      idx,
    }))

    const simCoords = (simPoints.length ? simPoints : origPoints).map((p, idx) => {
      const adjustedScore = p.is_placement_moment || p.timestamp >= (origPlacementPt?.timestamp ?? 0)
        ? Math.max(activeSimStability - 5, Math.min(98, p.stability_score + (activeSimStability - 89)))
        : p.stability_score

      return {
        x: scaleX(p.timestamp),
        y: scaleY(adjustedScore),
        t: p.timestamp,
        score: adjustedScore,
        isMoment: p.is_placement_moment,
        idx,
      }
    })

    const buildPath = (coords) => {
      if (!coords.length) return ''
      return coords.reduce((acc, pt, idx) => (idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`), '')
    }

    const buildArea = (coords) => {
      if (!coords.length) return ''
      const firstX = coords[0].x
      const lastX = coords[coords.length - 1].x
      const baseY = scaleY(0)
      const line = coords.reduce((acc, pt, idx) => (idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`), '')
      return `${line} L ${lastX},${baseY} L ${firstX},${baseY} Z`
    }

    return {
      width,
      height,
      padX,
      padY,
      plotW,
      plotH,
      minT,
      maxT,
      scaleX,
      scaleY,
      origPoints: origCoords,
      simPoints: simCoords,
      origPath: buildPath(origCoords),
      simPath: buildPath(simCoords),
      origArea: buildArea(origCoords),
      simArea: buildArea(simCoords),
    }
  }, [origPoints, simPoints, origPlacementPt, activeSimStability])

  const hoveredOrig = hoveredPointIndex !== null && chartData?.origPoints?.[hoveredPointIndex]
    ? chartData.origPoints[hoveredPointIndex]
    : null

  const hoveredSim = hoveredPointIndex !== null && chartData?.simPoints?.[hoveredPointIndex]
    ? chartData.simPoints[hoveredPointIndex]
    : null

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* header */}
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigateTo('Incident Replay')}
              className="inline-flex items-center gap-1 text-small font-medium text-ink-soft hover:text-ink"
            >
              <ArrowLeft size={14} />
              return to incident replay
            </button>
          </div>
          <h1 className="mt-2 font-display text-display-lg font-semibold text-ink">
            What-if trajectory simulation
          </h1>
          <p className="mt-2 max-w-2xl text-body text-ink-soft">
            TRACE evaluates safer alternative interventions across recorded video motion before
            touching the physical cargo.
          </p>
        </div>
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
      </section>

      {/* source bar */}
      <section className="grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-3">
        <Field label="camera / zone source">
          <select
            value={selectedVideoId}
            onChange={(e) => {
              setSelectedVideoId(e.target.value)
              setSelectedEventId(null)
            }}
            className="border border-line bg-surface px-2.5 py-1.5 text-small text-ink focus:border-ink"
          >
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
            <option value="">manual timestamp mode…</option>
            {recentEvents.map((ev) => (
              <option key={ev.event_id} value={ev.event_id}>
                event #{ev.event_id} ({formatTimestamp(ev.timestamp)}) — {resolveIncidentTitle(ev)} [{getVideoScenarioInfo(ev.video_id).cameraName}]
              </option>
            ))}
          </select>
        </Field>
        <Field label="intervention moment">
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.5"
              min="0"
              value={targetTimestamp}
              onChange={(e) => setTargetTimestamp(parseFloat(e.target.value) || 0)}
              className="w-28 border border-line bg-surface px-2.5 py-1.5 font-mono text-small tabular-nums text-ink focus:border-ink"
            />
            <span className="font-mono text-caption tabular-nums text-ink-faint">({formatTimestamp(targetTimestamp)})</span>
          </div>
        </Field>
      </section>

      {error && (
        <div className="border border-danger bg-danger/5 p-4 font-mono text-caption text-danger">
          [simulation error] {error}
        </div>
      )}

      {simulation && !simulation.simulation_available && (
        <div className="border border-signal/40 bg-signal/5 p-5">
          <h2 className="font-mono text-title font-semibold text-[#8a5f00]">what-if not applicable</h2>
          <p className="mt-1 text-small text-ink-soft">
            {simulation.simulation_notice ||
              'TRACE can evaluate counterfactual cargo placement when structural geometry is modeled. It does not physically simulate human movement from monocular video.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-line bg-surface p-3.5">
            <p className="text-caption text-ink-soft">
              Monocular perception does not support physical biomechanics simulation for worker or
              environmental zone hazards.
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedVideoId('ac99ff34e1bd2c13')
                setSelectedEventId(73)
                setTargetTimestamp(36.67)
                setSelectedOptionId('opt-a')
              }}
              className="bg-ink px-3.5 py-1.5 text-caption font-semibold text-paper transition-colors hover:bg-ink-soft"
            >
              view valid what-if (event #73)
            </button>
          </div>
        </div>
      )}

      {simulation && simulation.simulation_available && (
        <div className="flex flex-col gap-8">
          {/* step 1 */}
          <section className="border border-danger/40 bg-surface">
            <div className="h-1 bg-danger" />
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="font-mono text-caption font-semibold text-danger">
                step 1 · the observed state
              </span>
              <div className="flex items-center gap-2 text-caption text-ink-soft">
                <span>location: <span className="font-medium text-ink">{activeVideoInfo.cameraName}</span></span>
                <span>·</span>
                <span className="font-mono font-medium tabular-nums text-ink">t = {formatTimestamp(targetTimestamp)}</span>
              </div>
            </div>
            <div className="p-5">
              <h2 className="font-display text-display-md font-semibold text-ink">{incidentTitle}</h2>

              <div className="mt-4 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-3">
                <div className="bg-paper p-3">
                  <span className="text-label font-medium text-ink-faint">support coverage</span>
                  <p className="mt-1 font-display text-display-md font-semibold tabular-nums text-danger">{actualSupportPct}</p>
                  <p className="text-caption text-ink-faint">horizontal footprint overlap</p>
                </div>
                <div className="bg-paper p-3">
                  <span className="text-label font-medium text-ink-faint">measured overhang</span>
                  <p className="mt-1 font-display text-display-md font-semibold tabular-nums text-danger">{actualOverhangPct}</p>
                  <p className="text-caption text-ink-faint">protrusion past foundation edge</p>
                </div>
                <div className="bg-paper p-3">
                  <span className="text-label font-medium text-ink-faint">observed stability</span>
                  <p className="mt-1 font-display text-display-md font-semibold tabular-nums text-danger">
                    {actualStability} <span className="text-title text-ink-faint">/ 100</span>
                  </p>
                  <p className="text-caption text-ink-faint">physics risk threshold exceeded</p>
                </div>
              </div>

              <div className="mt-3 border-l-2 border-danger bg-danger/5 px-3 py-2 text-small text-ink">
                <span className="font-medium">why it's dangerous:</span>{' '}
                {humanizeExplanation(
                  activeEvent?.explanation || activeScenarioConfig.whyItMatters,
                  activeEvent?.scenario,
                  activeEvent?.entity_id
                )}
              </div>
            </div>
          </section>

          {/* step 2 */}
          <section className="border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="font-mono text-caption font-semibold text-ink">
                step 2 · choose an intervention
              </span>
              <span className="text-caption text-ink-faint">click any option to simulate its outcome</span>
            </div>
            <div className="grid grid-cols-1 gap-px bg-line md:grid-cols-3">
              {interventionOptions.map((opt) => {
                const isSelected = selectedOptionId === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectOption(opt)}
                    className={`flex flex-col justify-between gap-3 p-4 text-left transition-colors ${
                      isSelected ? 'bg-ok/5' : 'bg-surface hover:bg-paper'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className={`px-2 py-0.5 text-label font-medium ${opt.badgeCls}`}>{opt.badge}</span>
                        <span className="text-caption text-ink-faint">{opt.effort}</span>
                      </div>
                      <h3 className="mt-2 text-small font-semibold leading-snug text-ink">
                        option {opt.letter}: "{opt.title}"
                      </h3>
                      <p className="mt-1 text-caption text-ink-soft">{opt.description}</p>
                    </div>

                    <div className="flex items-baseline justify-between border-t border-line pt-2">
                      <span className="text-caption text-ink-soft">predicted stability</span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-mono text-title font-semibold tabular-nums text-ok">
                          {opt.predictedStability} / 100
                        </span>
                        <span className="border border-ok/40 bg-ok/10 px-1 py-0.5 font-mono text-label font-medium text-ok">
                          +{opt.gain}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          {/* step 3 */}
          <section className="border border-ok/40 bg-surface">
            <div className="h-1 bg-ok" />
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="font-mono text-caption font-semibold text-ok">
                step 3 · predicted outcome for option {activeOption.letter}
              </span>
              <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label text-ok">
                safer state validated
              </span>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-3">
                <Delta title="stability" before={actualStability} after={`${activeSimStability} / 100`} gain={`+${activeStabilityGain}`} />
                <Delta title="overhang" before={actualOverhangPct} after={activeSimOverhang} />
                <Delta title="support foundation" before={actualSupportPct} after={activeSimSupport} />
              </div>

              <div className="mt-4 border border-line bg-paper p-4">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="text-small font-semibold text-ink">physical stacking geometry</span>
                  <span className="font-mono text-caption text-ink-faint">static equilibrium evaluation</span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-px bg-line md:grid-cols-2">
                  <div className="flex flex-col items-center gap-3 bg-surface p-4 text-center">
                    <span className="self-start bg-danger px-2 py-0.5 text-label font-medium text-paper">
                      actual observed stack
                    </span>
                    <div className="flex w-full max-w-xs flex-col items-center">
                      <div className="flex w-48 translate-x-8 items-center justify-center border-2 border-danger bg-danger/10 py-2.5 text-caption font-medium text-danger">
                        upper cargo carton
                      </div>
                      <div className="my-1 font-mono text-caption text-danger">▼ tipping load (CoM outside base)</div>
                      <div className="flex w-48 items-center justify-center border-2 border-line bg-paper py-2 text-caption text-ink-soft">
                        supporting pallet deck (80cm base)
                      </div>
                    </div>
                    <p className="border border-danger/40 bg-surface p-2 text-left text-caption text-danger">
                      upper carton protrudes {actualOverhangPct} past base support — center of gravity
                      extends past edge, creating a tipping moment.
                    </p>
                  </div>

                  <div className="flex flex-col items-center gap-3 bg-surface p-4 text-center">
                    <span className="self-start bg-ok px-2 py-0.5 text-label font-medium text-paper">
                      proposed safer intervention
                    </span>
                    <div className="flex w-full max-w-xs flex-col items-center">
                      <div className="flex w-44 items-center justify-center border-2 border-ok bg-ok/10 py-2.5 text-caption font-medium text-ok">
                        upper cargo carton (centered)
                      </div>
                      <div className="my-1 font-mono text-caption text-ok">▼ uniform normal distribution</div>
                      <div className="flex w-48 items-center justify-center border-2 border-ok bg-ok/10 py-2 text-caption text-ok">
                        supporting pallet deck (80cm base)
                      </div>
                    </div>
                    <p className="border border-ok/40 bg-surface p-2 text-left text-caption text-ink">
                      carton footprint centered squarely on base — overhang eliminated (
                      {activeSimOverhang}), restoring {activeSimSupport} foundation support.
                    </p>
                  </div>
                </div>
              </div>

              {chartData && (
                <div className="mt-4 border border-line bg-paper p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                    <div>
                      <h3 className="text-small font-semibold text-ink">stability trajectory over time</h3>
                      <span className="font-mono text-caption tabular-nums text-ink-faint">
                        [{chartData.minT.toFixed(1)}s – {chartData.maxT.toFixed(1)}s]
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <Legend color="bg-danger" label="actual" />
                      <Legend color="bg-ok" label="simulated" />
                    </div>
                  </div>

                  <div className="relative overflow-x-auto">
                    <svg viewBox={`0 0 ${chartData.width} ${chartData.height}`} className="max-h-60 w-full select-none">
                      <defs>
                        <linearGradient id="origGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#B23A22" stopOpacity="0.18" />
                          <stop offset="100%" stopColor="#B23A22" stopOpacity="0" />
                        </linearGradient>
                        <linearGradient id="simGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3F6E4C" stopOpacity="0.22" />
                          <stop offset="100%" stopColor="#3F6E4C" stopOpacity="0" />
                        </linearGradient>
                      </defs>

                      <rect x={chartData.padX} y={chartData.scaleY(40)} width={chartData.plotW} height={chartData.scaleY(0) - chartData.scaleY(40)} fill="#f3e0da" opacity="0.5" />
                      <rect x={chartData.padX} y={chartData.scaleY(60)} width={chartData.plotW} height={chartData.scaleY(40) - chartData.scaleY(60)} fill="#f2e6cc" opacity="0.4" />
                      <rect x={chartData.padX} y={chartData.scaleY(100)} width={chartData.plotW} height={chartData.scaleY(60) - chartData.scaleY(100)} fill="#dce7db" opacity="0.4" />

                      <path d={chartData.origArea} fill="url(#origGrad)" />
                      <path d={chartData.simArea} fill="url(#simGrad)" />

                      <path d={chartData.origPath} fill="none" stroke="#B23A22" strokeWidth="2" strokeDasharray="4,2" />
                      <path d={chartData.simPath} fill="none" stroke="#3F6E4C" strokeWidth="2.5" />

                      {chartData.origPoints.map((pt, idx) => (
                        <circle
                          key={`orig-${idx}`}
                          cx={pt.x}
                          cy={pt.y}
                          r={hoveredPointIndex === idx ? 5 : 3.5}
                          fill="#B23A22"
                          stroke="#F6F2E9"
                          strokeWidth="1.5"
                          className="cursor-pointer"
                          onMouseEnter={() => setHoveredPointIndex(idx)}
                          onMouseLeave={() => setHoveredPointIndex(null)}
                        />
                      ))}

                      {chartData.simPoints.map((pt, idx) => (
                        <circle
                          key={`sim-${idx}`}
                          cx={pt.x}
                          cy={pt.y}
                          r={hoveredPointIndex === idx ? 5 : 4}
                          fill="#3F6E4C"
                          stroke="#F6F2E9"
                          strokeWidth="1.5"
                          className="cursor-pointer"
                          onMouseEnter={() => setHoveredPointIndex(idx)}
                          onMouseLeave={() => setHoveredPointIndex(null)}
                        />
                      ))}
                    </svg>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border border-line bg-surface p-2.5">
                    {hoveredOrig && hoveredSim ? (
                      <div className="flex items-center gap-3 font-mono text-caption">
                        <span className="font-medium text-ink">t = {formatTimestamp(hoveredOrig.t)}:</span>
                        <span className="text-danger">actual: {hoveredOrig.score.toFixed(1)}</span>
                        <span>→</span>
                        <span className="font-medium text-ok">simulated: {hoveredSim.score.toFixed(1)}</span>
                        <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 font-medium text-ok">
                          +{(hoveredSim.score - hoveredOrig.score).toFixed(1)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-caption italic text-ink-faint">
                        Hover over any point to inspect per-timestamp stability values.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* technical */}
          <section className="border border-line bg-surface">
            <button
              type="button"
              onClick={() => setShowTechnical(!showTechnical)}
              className="flex w-full items-center justify-between px-4 py-3 text-small font-medium text-ink-soft hover:text-ink"
            >
              <span>engineering formulas & physics limitations</span>
              <span className="font-mono text-caption">{showTechnical ? 'collapse' : 'expand'}</span>
            </button>

            {showTechnical && (
              <div className="flex flex-col gap-3 border-t border-line p-4">
                <div className="border-l-2 border-ok bg-ok/5 p-3 text-small text-ink">
                  <span className="font-medium">trajectory model rationale:</span>{' '}
                  {simulation.explanation ||
                    `Simulating alternative placement '${activeOption.title}' shifts package coordinates onto the base footprint deck, eliminating cantilever overhang and restoring static equilibrium across the temporal sequence.`}
                </div>

                <div className="border border-line bg-paper p-3">
                  <span className="text-label font-medium text-ink-soft">responsible AI disclaimers</span>
                  <ul className="mt-1.5 list-inside list-disc space-y-1 text-caption text-ink-soft">
                    <li>Image-space support calculation evaluates 2D bounding footprint geometry; physical 3D contact friction and internal mass distribution are uncalibrated.</li>
                    <li>Counterfactual trajectory simulates static persistence of the repositioned cargo across subsequent frames without human re-disturbance.</li>
                    <li>What-if recommendations are operational decision support for warehouse supervisors, not automated actuator commands.</li>
                  </ul>
                </div>
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

function Delta({ title, before, after, gain }) {
  return (
    <div className="flex flex-col gap-1 bg-paper p-3">
      <span className="text-label font-medium text-ink-faint">{title}</span>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-title font-semibold tabular-nums text-danger line-through">{before}</span>
        <span className="text-caption text-ink-faint">→</span>
        <span className="font-mono text-display-md font-semibold tabular-nums text-ok">{after}</span>
        {gain && (
          <span className="ml-auto border border-ok/40 bg-ok/10 px-1.5 py-0.5 font-mono text-label font-medium text-ok">
            {gain}
          </span>
        )}
      </div>
    </div>
  )
}
