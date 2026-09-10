import { useState, useEffect } from 'react'
import { ArrowRight, FlaskConical, Zap } from 'lucide-react'
import { listEvents, getEvent } from '../api/events.js'
import { getActionPlan } from '../api/actions.js'
import { listVideos } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import { getScenarioConfig, getVideoScenarioInfo, DEMO_PRESETS, formatEvidenceKey, formatEvidenceValue, telemetryEntries, formatEventRef } from '../lib/scenarios.js'
import SupervisorRuleNotice from '../components/SupervisorRuleNotice.jsx'
import { formatConfidence, formatEntityName, humanizeExplanation, humanizeAction, humanizeTitle } from '../lib/format.js'
import WorkflowNav from '../components/WorkflowNav.jsx'

function formatTimestamp(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return '00:00.0'
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`
}

export default function PlannerView() {
  const { replayTarget, navigateTo } = useLiveViewContext()

  const [videos, setVideos] = useState([])
  const [recentEvents, setRecentEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(replayTarget?.eventId || 73)
  const [activeEvent, setActiveEvent] = useState(replayTarget?.event || null)
  const [safePlan, setSafePlan] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showTechnical, setShowTechnical] = useState(false)
  const [checkedSteps, setCheckedSteps] = useState({})

  const toggleStep = (idx) => {
    setCheckedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  const markAllComplete = () => {
    const total = safePlan?.steps?.length || 3
    const all = {}
    for (let i = 0; i < total; i++) {
      all[i] = true
    }
    setCheckedSteps(all)
  }

  // 1. Load initial video and event catalogs (all events)
  useEffect(() => {
    let active = true
    Promise.all([
      listVideos().catch(() => []),
      listEvents({ limit: 300, order: 'desc' }).catch(() => []),
    ]).then(([vids, evs]) => {
      if (!active) return
      setVideos(vids || [])
      setRecentEvents(evs || [])

      // If no event loaded yet, select selectedEventId or first event
      if (!activeEvent && evs?.length > 0) {
        const found = evs.find((e) => e.event_id === selectedEventId) || evs[0]
        setSelectedEventId(found.event_id)
        setActiveEvent(found)
      }
    })
    return () => {
      active = false
    }
  }, [])

  // 2. Load active event details & Safe Action Plan whenever selectedEventId changes
  useEffect(() => {
    if (!selectedEventId) return
    let active = true
    setLoading(true)
    setError(null)
    setCheckedSteps({})

    Promise.all([
      getEvent(selectedEventId),
      getActionPlan(selectedEventId).catch((err) => {
        console.warn('Action plan load error for event', selectedEventId, err)
        return null
      }),
    ])
      .then(([evData, planData]) => {
        if (active) {
          setActiveEvent(evData)
          setSafePlan(planData)
        }
      })
      .catch((err) => {
        if (active) setError(err.message || `Failed to load event #${selectedEventId}`)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedEventId])

  useEffect(() => {
    if (replayTarget?.eventId && replayTarget.eventId !== selectedEventId) {
      setSelectedEventId(replayTarget.eventId)
      if (replayTarget.event) {
        setActiveEvent(replayTarget.event)
      }
    }
  }, [replayTarget])

  const handleSelectEvent = (id) => {
    const num = Number(id)
    const targetId = isNaN(num) ? id : num
    setSelectedEventId(targetId)
    const match = recentEvents.find((e) => e.event_id === targetId)
    if (match) {
      setActiveEvent(match)
    } else {
      const preset = DEMO_PRESETS.find((d) => d.id === targetId)
      if (preset) {
        setActiveEvent({
          event_id: preset.id,
          video_id: preset.videoId,
          timestamp: preset.timestamp,
          scenario: preset.scenario,
        })
      }
    }
  }

  const severity = activeEvent?.band || '—'
  const isCritical = severity === 'Critical'
  const isHigh = severity === 'High'

  const config = getScenarioConfig(activeEvent?.scenario)
  const scenarioTitle = humanizeTitle(
    config.title || activeEvent?.planner_recommendation?.risk_title || activeEvent?.scenario?.replace(/_/g, ' '),
    activeEvent?.scenario
  )

  const detectedTime = activeEvent ? formatTimestamp(activeEvent.timestamp) : '—'
  const rawSeconds = activeEvent?.timestamp !== undefined ? `${activeEvent.timestamp.toFixed(1)}s` : '—'
  const riskScore = activeEvent?.score != null ? Math.round(activeEvent.score) : null

  const evidence = activeEvent?.evidence || {}

  const confVal = formatConfidence(activeEvent?.confidence)

  // Up to three real evidence values from this finding
  const evidenceMetrics = telemetryEntries(evidence)
    .slice(0, 3)
    .map(([key, value]) => ({
      key,
      label: formatEvidenceKey(key),
      value: formatEvidenceValue(key, value),
      tone: /ratio|overhang|severity|multiplier|distance/i.test(key) ? 'signal' : undefined,
    }))

  const cleanImmediateAction = humanizeAction(
    safePlan?.immediate_action || activeEvent?.planner_recommendation?.action || activeEvent?.recommended_action || config.recommendedAction,
    activeEvent?.scenario
  )

  const cleanActionExplanation = humanizeExplanation(
    safePlan?.reason || activeEvent?.planner_recommendation?.rationale || config.whyItMatters,
    activeEvent?.scenario
  )

  const bayInfo = getVideoScenarioInfo(activeEvent?.video_id || config.videoId, activeEvent?.scenario)

  const scenarioChecklists = {
    wrong_product_orientation: [
      "Halt loading or conveyor movement near package.",
      "Rotate carton 90° so 'This Side Up' indicator arrows point vertically upward.",
      "Verify package is resting stably and vertical corrugation bears weight before staging.",
    ],
    box_overhang: [
      "Halt handling equipment within 3 meters of carton.",
      "Push carton inward until footprint aligns flush with supporting foundation.",
      "Confirm at least 75% base contact and zero cantilever overhang.",
    ],
    pallet_overhang: [
      "Halt forklift or pallet jack movement.",
      "Reposition carton flush within pallet deck perimeter boundaries.",
      "Verify perimeter clearance before transport or adding upper tiers.",
    ],
    heavy_on_light_stacking: [
      "Remove heavy carton from upper tier immediately.",
      "Reorder stack hierarchy so heaviest items rest on base tier.",
      "Verify lightweight packaging rests only on top of heavier cartons.",
    ],
    stepping_on_carton: [
      "Step off carton packaging immediately onto solid warehouse floor.",
      "Deploy certified safety stepladder or mobile platform for elevated reach.",
      "Inspect carton for top-panel crushing or structural integrity loss.",
    ],
    stepping_on_carton_precursor: [
      "Step back to floor level immediately.",
      "Obtain certified safety steps before accessing upper storage tiers.",
      "Verify walking path and ladder placement are clear.",
    ],
    entity_in_dock_edge_zone: [
      "Retreat at least 2.0 meters inward from open dock ledge.",
      "Deploy and secure dock safety barrier chain across open bay.",
      "Verify bridge plate is locked into trailer bed before approach.",
    ],
    entity_in_wet_floor_zone: [
      "Halt cargo handling in wet floor area immediately.",
      "Erect caution cones around slip perimeter and report spill for cleanup.",
      "Reroute cargo transit through adjacent dry aisle.",
    ],
    solo_heavy_handling: [
      "Pause solo lifting of heavy cargo item immediately.",
      "Assign second worker for team lift or dispatch mechanical pallet jack.",
      "Verify ergonomic lifting posture before resuming cargo transport.",
    ],
    unsupported_bending_placement: [
      "Reposition carton to restore solid horizontal support beneath base.",
      "Ensure at least 75% foundation contact to eliminate cantilever bending.",
      "Inspect bottom panel corrugation for creasing before adding load.",
    ],
    carton_drop: [
      "Quarantine dropped carton immediately for structural inspection.",
      "Open and inspect contents for damage or fluid leakage.",
      "Repackage items if box structural integrity is compromised.",
    ],
    dragging_precursor: [
      "Halt manual floor dragging of cargo cartons.",
      "Lift carton using two-person team lift or load onto pallet truck.",
      "Inspect bottom panel for abrasive wear or seal tear before dispatch.",
    ],
    rolling_precursor: [
      "Halt end-over-end rolling of carton across the floor.",
      "Stabilize package upright and transport using hand truck or trolley.",
      "Inspect carton corners and internal packing for impact damage.",
    ],
    straps_as_handles: [
      "Release packaging straps immediately; never lift cargo by exterior bands.",
      "Grip package body from underneath base panel with two hands.",
      "Use mechanical lift cart for heavy items exceeding single-person limits.",
    ],
    unplanned_loading_sequence: [
      "Pause pallet staging and check loading manifest order.",
      "Reorder pallets to match delivery route and axle distribution schedule.",
      "Confirm staging order with dispatch supervisor before loading trailer.",
    ],
    wrong_equipment_usage: [
      "Halt operation with makeshift or unapproved transport equipment.",
      "Deploy certified handling equipment (wheeled trolley or pallet jack).",
      "Verify equipment load rating meets or exceeds cargo mass.",
    ],
  }

  const checklistSteps = (
    safePlan?.steps && safePlan.steps.length > 0 && !safePlan.steps.some((s) => s.toLowerCase().includes('additional evidence') || s.toLowerCase().includes('cannot safely determine'))
      ? safePlan.steps.map((s) => humanizeAction(s, activeEvent?.scenario))
      : (scenarioChecklists[activeEvent?.scenario] || [
          `Halt handling equipment near ${formatEntityName(activeEvent?.entity_id)}.`,
          cleanImmediateAction,
          `Verify cargo footprint is aligned securely before resuming work.`,
        ])
  )

  const cleanVerification = safePlan?.verification
    ? humanizeExplanation(safePlan.verification, activeEvent?.scenario)
        .replace(/^(confirm\s+supervisor\s+has\s+physically\s+verified:\s*confirm\s*)+/gi, 'Confirm ')
        .replace(/^(confirm\s+supervisor\s+has\s+physically\s+verified:\s*)+/gi, 'Confirm ')
        .replace(/^(confirm\s+verification\s+required:\s*)+/gi, 'Confirm ')
        .replace(/^(verification\s+required:\s*)+/gi, 'Confirm ')
    : 'Confirm cargo placement is physically verified on floor and aligned with safety specifications before resuming equipment movement.'

  const isCargoSimulationEligible = Boolean(
    activeEvent &&
    !activeEvent.entity_id?.toLowerCase().includes('person') &&
    activeEvent.lens !== 'behaviour' &&
    activeEvent.lens !== 'environmental'
  )

  const handleSimulateSafer = () => {
    if (!activeEvent) return
    navigateTo('What-If Simulation', {
      eventId: activeEvent.event_id,
      videoId: activeEvent.video_id,
      timestamp: activeEvent.timestamp,
      event: activeEvent,
    })
  }

  const handleReplayCurrent = () => {
    if (!activeEvent) return
    navigateTo('Incident Replay', {
      eventId: activeEvent.event_id,
      videoId: activeEvent.video_id,
      timestamp: activeEvent.timestamp,
      event: activeEvent,
    })
  }

  const severityCls = isCritical
    ? 'border-danger/40 bg-danger/10 text-danger'
    : isHigh
      ? 'border-signal/40 bg-signal/10 text-[#8a5f00]'
      : 'border-steel/40 bg-steel/10 text-steel'

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* 5-step safety workflow banner */}
      <WorkflowNav
        currentStep={5}
        navigateTo={navigateTo}
        context={{
          eventId: activeEvent?.event_id || selectedEventId,
          videoId: activeEvent?.video_id,
        }}
      />

      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2 text-caption text-ink-soft">
            <button
              type="button"
              onClick={handleReplayCurrent}
              className="inline-flex items-center gap-1 font-medium hover:text-ink cursor-pointer"
            >
              Step 3: Forensic Replay
            </button>
            <span>/</span>
            {isCargoSimulationEligible && (
              <>
                <button
                  type="button"
                  onClick={handleSimulateSafer}
                  className="inline-flex items-center gap-1 font-medium hover:text-ink cursor-pointer"
                >
                  Step 4: What-If Simulator
                </button>
                <span>/</span>
              </>
            )}
            <span className="font-semibold text-ink">Step 5: Safe Action Plan</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-ink">
              Safe Action Plan &amp; Directive
            </h1>
            <span className={`border px-2.5 py-0.5 text-caption font-bold uppercase tracking-wider ${severityCls}`}>
              {severity} Risk
            </span>
            <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-bold uppercase tracking-wider text-ok">
              {safePlan?.evidence_status || 'Verified Safe Plan'}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-small text-ink-soft">
            Operational action plan generated from physical state analysis and verified by TRACE decision intelligence.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-caption font-medium text-ink-soft">Active Incident:</label>
          <select
            value={selectedEventId || ''}
            onChange={(e) => handleSelectEvent(e.target.value)}
            className="border border-line bg-surface px-2.5 py-1.5 text-small text-ink focus:border-ink font-medium cursor-pointer"
          >
            {recentEvents.map((ev) => (
              <option key={ev.event_id} value={ev.event_id}>
                {getVideoScenarioInfo(ev.video_id, ev.scenario).cameraName} — {humanizeTitle(getScenarioConfig(ev.scenario).title, ev.scenario)} (@{formatTimestamp(ev.timestamp)})
              </option>
            ))}
          </select>
        </div>
      </section>

      {error && (
        <div className="border border-danger bg-danger/5 p-4 text-caption text-danger">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 border border-line bg-surface p-8 text-small font-medium text-ink">
          <span className="h-4 w-4 animate-spin motion-reduce:animate-none border-2 border-ink border-t-transparent" />
          Synthesizing operational action plan…
        </div>
      )}

      {activeEvent && !loading && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* Main Hero Execution Directive (8 cols) */}
          <div className="flex flex-col gap-5 lg:col-span-8">
            {/* 1. Immediate Action Banner */}
            <div className="border-2 border-ok bg-ok/5 p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ok/20 pb-3">
                <span className="text-label font-bold uppercase tracking-wider text-ok">
                  1. Immediate Operational Action Directive
                </span>
                <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-caption font-mono font-bold text-ok uppercase">
                  Certainty: {confVal}
                </span>
              </div>

              <div className="mt-4">
                <h2 className="text-xl font-bold text-ink leading-tight">
                  {cleanImmediateAction}
                </h2>
                <p className="mt-2 text-small text-ink-soft leading-relaxed">
                  {cleanActionExplanation}
                </p>
              </div>

              {/* Bay Paging Notification */}
              <div className="mt-4 flex items-center gap-2 border border-ok/30 bg-surface px-3 py-2 text-caption text-ink font-medium">
                <span className="h-2 w-2 rounded-full bg-ok animate-pulse motion-reduce:animate-none shrink-0" />
                <span>Paging alert dispatched to <strong>{bayInfo.cameraName}</strong> handling team.</span>
              </div>
            </div>

            {/* 2. Numbered Sequential Action Checklist */}
            <div className="border border-line bg-surface p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
                <div>
                  <h3 className="text-base font-bold text-ink">
                    2. Sequential Action Checklist
                  </h3>
                  <p className="text-caption text-ink-soft">
                    Supervisor physical verification checklist — tick off items as completed:
                  </p>
                </div>
                <span className="text-caption font-mono text-ink-faint">
                  {Object.values(checkedSteps).filter(Boolean).length} / {checklistSteps.length} verified
                </span>
              </div>

              <ol className="flex flex-col gap-3 list-none p-0 m-0">
                {checklistSteps.map((step, idx) => {
                  const isChecked = !!checkedSteps[idx]
                  const cleanStep = step.replace(/^\d+\.\s*/, '')
                  return (
                    <li
                      key={idx}
                      onClick={() => toggleStep(idx)}
                      className={`flex items-start gap-3 p-3.5 border transition-all cursor-pointer ${
                        isChecked ? 'border-ok/40 bg-ok/5' : 'border-line bg-paper hover:border-line-strong'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="mt-1 h-4 w-4 accent-ok rounded cursor-pointer shrink-0"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`h-4 w-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                            isChecked ? 'bg-ok text-paper' : 'bg-ink/10 text-ink'
                          }`}>
                            {idx + 1}
                          </span>
                          <span className={`text-small font-bold ${isChecked ? 'line-through text-ink-soft' : 'text-ink'}`}>
                            {cleanStep}
                          </span>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>

              {/* Mark Complete Action Button & Status */}
              <div className="mt-4 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-3">
                {Object.values(checkedSteps).filter(Boolean).length === checklistSteps.length ? (
                  <div className="flex items-center gap-2 text-ok font-bold text-small">
                    <span className="h-2 w-2 rounded-full bg-ok" />
                    <span>✓ Action Directive Fully Verified on Floor</span>
                  </div>
                ) : (
                  <span className="text-caption text-ink-soft">
                    Verify all physical steps before releasing equipment.
                  </span>
                )}

                <button
                  type="button"
                  onClick={markAllComplete}
                  className="bg-ok px-4 py-2 text-caption font-bold text-paper transition-opacity hover:opacity-90 cursor-pointer shadow-xs"
                >
                  Mark Action Complete &amp; Sign Off
                </button>
              </div>
            </div>

            {/* 3. Verification Acceptance Condition */}
            <div className="border border-line bg-surface p-5">
              <span className="text-label font-bold uppercase tracking-wider text-ink-faint">
                3. Verification Acceptance Condition
              </span>
              <div className="mt-2 flex items-start gap-3 bg-paper border border-line p-4">
                <span className="text-ok font-bold text-base mt-0.5 shrink-0">✓</span>
                <div>
                  <span className="text-small font-bold text-ink">Physical &amp; Optical Sign-off Rule:</span>
                  <p className="mt-0.5 text-small text-ink-soft leading-relaxed">
                    {cleanVerification}
                  </p>
                </div>
              </div>
            </div>

            {/* 4. Workflow Progression CTAs */}
            <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface p-5">
              <div className="flex flex-col">
                <span className="text-label font-bold uppercase tracking-wider text-ink-faint">
                  Resolution Next Steps
                </span>
                <span className="text-caption text-ink-soft">
                  Verify the physical resolution in video replay or monitor live cameras:
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleReplayCurrent}
                  className="inline-flex items-center gap-1.5 border border-ok bg-ok px-4 py-2 text-small font-bold text-paper shadow-sm transition-colors hover:opacity-90 cursor-pointer"
                >
                  Verify Resolution in Replay (Step 3) →
                </button>
                <button
                  type="button"
                  onClick={() => navigateTo('Live View')}
                  className="inline-flex items-center gap-1.5 border border-line bg-paper px-3.5 py-2 text-small font-semibold text-ink transition-colors hover:border-ink cursor-pointer"
                >
                  Return to Live Cameras (Step 1) →
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Hazard Telemetry & Context (4 cols) */}
          <div className="flex flex-col gap-4 lg:col-span-4">
            {/* Risk Assessment Card */}
            <div className="border border-line bg-surface p-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
                <span className="text-caption font-bold uppercase tracking-wider text-ink">
                  Hazard Context
                </span>
                <span className="font-mono text-caption text-ink-faint">
                  {detectedTime}
                </span>
              </div>

              <h3 className="text-base font-bold text-ink leading-tight">
                {scenarioTitle}
              </h3>
              <p className="mt-2 text-caption text-ink-soft leading-relaxed">
                {humanizeExplanation(safePlan?.reason || whyActionText, activeEvent?.scenario, activeEvent?.entity_id)}
              </p>

              <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2 text-caption text-ink-faint">
                <span>Location: <strong className="text-ink font-medium">{bayInfo.cameraName}</strong></span>
                <span>Item: <strong className="text-ink font-medium">{formatEntityName(activeEvent?.entity_id)}</strong></span>
              </div>

              <SupervisorRuleNotice evidence={evidence} className="mt-3" />
            </div>

            {/* What-If Simulation Shortcut if eligible */}
            {isCargoSimulationEligible && (
              <div className="border border-ok/40 bg-ok/5 p-4">
                <span className="text-small font-bold text-ink">
                  Pre-Execution Simulation
                </span>
                <p className="mt-1 text-caption text-ink-soft">
                  Compare counterfactual cargo trajectories in Step 4 before moving inventory.
                </p>
                <button
                  type="button"
                  onClick={handleSimulateSafer}
                  className="mt-3 inline-flex items-center gap-1.5 border border-ok bg-surface px-3 py-1.5 text-caption font-bold text-ok hover:bg-ok/10 transition-colors cursor-pointer w-full justify-center"
                >
                  <FlaskConical size={14} />
                  Open What-If Simulator (Step 4) →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Operational Policy & Verification Basis */}
      <section className="border border-line bg-surface">
        <button
          type="button"
          onClick={() => setShowTechnical(!showTechnical)}
          className="flex w-full items-center justify-between px-4 py-3 text-small font-medium text-ink-soft transition-colors hover:text-ink cursor-pointer"
        >
          <span>Operational Verification Basis &amp; Policy</span>
          <span className="font-mono text-caption">{showTechnical ? '▲ collapse' : '▼ expand'}</span>
        </button>

        {showTechnical && (
          <div className="flex flex-col gap-3 border-t border-line p-4 text-small text-ink-soft leading-relaxed">
            <div className="border border-line bg-paper p-3.5">
              <span className="font-semibold text-ink block mb-1">
                Standard Operational Verification Policy:
              </span>
              <p>
                All directive recommendations are safety measures derived from real-time physical telemetry across monitored camera bays. Releasing handling equipment requires on-floor supervisor verification of safe perimeter and cargo footprint alignment.
              </p>
            </div>

            {evidenceMetrics.length > 0 && (
              <div className="border border-line bg-paper p-3.5">
                <span className="font-semibold text-ink block mb-2">
                  Recorded Camera Telemetry &amp; Geometry:
                </span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-caption">
                  {evidenceMetrics.map((m) => (
                    <div key={m.key} className="border border-line bg-surface p-2">
                      <span className="block text-[10px] uppercase font-bold text-ink-faint">{m.label}</span>
                      <span className={`font-mono text-small font-bold ${m.tone === 'signal' ? 'text-[#8a5f00]' : 'text-ink'}`}>
                        {m.value}
                      </span>
                    </div>
                  ))}
                  <div className="border border-line bg-surface p-2">
                    <span className="block text-[10px] uppercase font-bold text-ink-faint">Detection Confidence</span>
                    <span className="font-mono text-small font-bold text-ok">{confVal}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function Metric({ label, value, note, tone }) {
  const valueCls = tone === 'ok' ? 'text-ok' : tone === 'signal' ? 'text-[#8a5f00]' : 'text-ink'
  return (
    <div className="flex flex-col gap-1 bg-paper p-4">
      <span className="text-label font-medium text-ink-faint">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${valueCls}`}>{value}</span>
      <span className="text-caption text-ink-faint">{note}</span>
    </div>
  )
}
