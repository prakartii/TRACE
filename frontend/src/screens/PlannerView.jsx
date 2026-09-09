import { useState, useEffect } from 'react'
import { ArrowRight, FlaskConical, Zap } from 'lucide-react'
import { listEvents, getEvent } from '../api/events.js'
import { getActionPlan } from '../api/actions.js'
import { listVideos } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import { getScenarioConfig, getVideoScenarioInfo, DEMO_PRESETS, formatEvidenceKey, formatEvidenceValue, telemetryEntries, formatEventRef } from '../lib/scenarios.js'
import SupervisorRuleNotice from '../components/SupervisorRuleNotice.jsx'
import { formatConfidence, formatEntityName, humanizeExplanation } from '../lib/format.js'
import WorkflowNav from '../components/WorkflowNav.jsx'

const REFERENCE_SCENARIOS = [
  {
    key: 'box_overhang',
    title: 'box overhang cantilever',
    lens: 'structural',
    action: 'Reposition carton inward onto support center; eliminate base overhang.',
    rationale: 'Cantilever overhang creates eccentric loading and tipping hazard.',
  },
  {
    key: 'heavy_on_light_stacking',
    title: 'heavy-on-light stacking',
    lens: 'structural',
    action: 'Move heavier load to lower/base position and ensure adequate support.',
    rationale: 'Reverse-mass stacking creates carton crushing and stack instability risk.',
  },
  {
    key: 'pallet_overhang',
    title: 'pallet overhang cantilever',
    lens: 'structural',
    action: 'Re-center the load within the available pallet support footprint.',
    rationale: 'Overhanging cartons risk impact with passing equipment and stack collapse.',
  },
  {
    key: 'wrong_product_orientation',
    title: 'wrong product orientation',
    lens: 'conformance',
    action: 'Rotate package to required upright this-side-up orientation.',
    rationale: 'Carton placed horizontally violates SKU vertical packaging requirements.',
  },
  {
    key: 'entity_in_dock_edge_zone',
    title: 'dock edge proximity zone',
    lens: 'environmental',
    action: 'Instruct worker to retreat 2.0 meters from dock edge threshold immediately.',
    rationale: 'Open dock threshold gap represents critical fall and vehicle impact hazard.',
  },
  {
    key: 'unplanned_loading_sequence',
    title: 'unplanned loading sequence',
    lens: 'operational',
    action: 'Re-sequence cargo loading according to weight distribution plan.',
    rationale: 'Arbitrary loading orders destabilize vehicle and rack center of gravity.',
  },
  {
    key: 'wrong_equipment_usage',
    title: 'wrong equipment usage',
    lens: 'operational',
    action: 'Halt non-compliant machinery; dispatch certified handling apparatus.',
    rationale: 'Unrated material handling equipment increases structural failure probability.',
  },
]

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
  const scenarioTitle = activeEvent
    ? (activeEvent.planner_recommendation?.risk_title || config.title)
    : 'Carton is extending beyond its supporting base'

  const detectedTime = activeEvent ? formatTimestamp(activeEvent.timestamp) : '—'
  const rawSeconds = activeEvent?.timestamp !== undefined ? `${activeEvent.timestamp.toFixed(1)}s` : '—'
  const riskScore = activeEvent?.score != null ? Math.round(activeEvent.score) : null

  const evidence = activeEvent?.evidence || {}



  const confVal = formatConfidence(activeEvent?.confidence)

  // Up to three real evidence values from this finding, whatever its scenario records.
  const evidenceMetrics = telemetryEntries(evidence)
    .slice(0, 3)
    .map(([key, value]) => ({
      key,
      label: formatEvidenceKey(key),
      value: formatEvidenceValue(key, value),
      tone: /ratio|overhang|severity|multiplier|distance/i.test(key) ? 'signal' : undefined,
    }))

  const actionHeadline = activeEvent?.planner_recommendation?.action?.split('.')[0] ||
    activeEvent?.recommended_action?.split('.')[0] ||
    config.recommendedAction.split('.')[0]

  const actionDetail = activeEvent?.planner_recommendation?.action ||
    activeEvent?.recommended_action ||
    config.recommendedAction

  const whyActionText = activeEvent?.planner_recommendation?.rationale || config.whyItMatters

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

      {/* header */}
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 flex items-center gap-2 text-label font-medium text-ink-soft">
            <Zap size={13} />
            operator decision engine
          </p>
          <h1 className="font-display text-display-lg font-semibold text-ink">Action center</h1>
          <p className="mt-2 max-w-2xl text-body text-ink-soft">
            TRACE turns a detected risk into a safe, explainable operator action.
          </p>
        </div>
        <button
          type="button"
          onClick={handleReplayCurrent}
          className="inline-flex items-center gap-2 border border-line bg-surface px-4 py-2 text-small font-medium text-ink transition-colors hover:border-line-strong cursor-pointer"
        >
          replay in video
          <ArrowRight size={15} />
        </button>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          <label className="text-small text-ink-soft">active incident</label>
          <select
            value={selectedEventId || ''}
            onChange={(e) => handleSelectEvent(e.target.value)}
            className="border border-line bg-paper px-2.5 py-1.5 text-small text-ink focus:border-ink cursor-pointer"
          >
            {recentEvents.map((ev) => (
              <option key={ev.event_id} value={ev.event_id}>
                event #{ev.event_id} ({formatTimestamp(ev.timestamp)}) · {getScenarioConfig(ev.scenario).title} [{getVideoScenarioInfo(ev.video_id).cameraName}]
              </option>
            ))}
          </select>
        </div>
      </section>

      {error && (
        <div className="border border-danger bg-danger/5 p-4 font-mono text-caption text-danger">
          [error] {error}
        </div>
      )}

      {/* step 1 */}
      <section className="border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <span className="text-small font-bold text-ink uppercase tracking-wide">
            Step 1: Current Hazard Assessment
          </span>
          <div className="flex items-center gap-2">
            <span className={`border px-2 py-0.5 text-label font-medium ${severityCls}`}>
              {severity} severity
            </span>
            <span className="text-caption text-ink-faint">
              {formatEventRef(activeEvent)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div>
            <h2 className="font-display text-display-md font-semibold text-ink">
              {scenarioTitle}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-soft">
              <span>
                detected at <span className="font-mono text-ink">{detectedTime}</span> ({rawSeconds})
              </span>
              <span>·</span>
              <span>
                Target: <span className="font-semibold text-ink">{formatEntityName(activeEvent?.entity_id)}</span>
              </span>
              <span>·</span>
              <span>
                camera: <span className="font-mono text-ink">{getVideoScenarioInfo(activeEvent?.video_id).cameraName || 'stream-1'}</span>
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-label font-medium text-ink-faint">risk score</span>
            <span className="font-display text-display-xl font-semibold tabular-nums text-ink">
              {riskScore ?? '—'}
              <span className="text-title text-ink-faint">/100</span>
            </span>
          </div>
        </div>
      </section>

      {/* step 2 · what is likely to happen */}
      <section className="border border-line bg-surface">
        <div className="border-b border-line px-4 py-2.5">
          <span className="text-small font-bold text-ink uppercase tracking-wide">
            Step 2: Predicted Risk &amp; Telemetry
          </span>
        </div>
        {/* Rendered from the finding's OWN recorded evidence keys. Evidence keys
            differ per scenario (a dock-edge finding records distance_to_edge, an
            overhang finding records overhang_ratio), so mapping fixed labels onto
            them silently mislabels or blanks real data — CLAUDE.md §30. */}
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          {evidenceMetrics.map((m) => (
            <Metric key={m.key} label={m.label} value={m.value} note="recorded evidence" tone={m.tone} />
          ))}
          <Metric label="visual certainty" value={confVal} note="detection confidence" tone="ok" />
        </div>
        {evidenceMetrics.length === 0 && (
          <div className="border-t border-line px-4 py-2 text-caption text-ink-faint">
            No supporting evidence values were recorded for this finding.
          </div>
        )}
        <SupervisorRuleNotice evidence={evidence} className="border-x-0 border-b-0" />
        <div className="border-t border-line px-4 py-3 text-small text-ink leading-relaxed">
          {humanizeExplanation(safePlan?.reason || whyActionText, activeEvent?.scenario, activeEvent?.entity_id)}
        </div>
      </section>

      {/* step 3 · what to do now */}
      <section className="border border-ok/40 bg-surface">
        <div className="h-1 bg-ok" />
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-small font-bold text-ok uppercase tracking-wide">
            Step 3: Recommended Safe Action Plan
          </span>
          <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-semibold text-ok uppercase">
            {safePlan?.evidence_status || 'Verified Safe Procedure'}
          </span>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <div>
            <p className="font-display text-display-md font-semibold leading-tight text-ink uppercase">
              {safePlan?.immediate_action || actionHeadline}
            </p>
            {!safePlan && (
              <p className="mt-2 text-body text-ink-soft">{actionDetail}</p>
            )}
          </div>

          {/* Sequential Action Checklist */}
          {safePlan?.steps && safePlan.steps.length > 1 && (
            <div className="flex flex-col gap-2 pt-3 border-t border-line">
              <span className="text-label font-medium text-ink-soft uppercase tracking-wider">
                action checklist (sequential steps)
              </span>
              <ol className="flex flex-col gap-2 list-none p-0 m-0">
                {safePlan.steps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-small text-ink font-medium leading-relaxed">
                    <span className="w-4 h-4 rounded-full bg-ok text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className={idx === 0 ? 'font-semibold text-ink' : 'text-ink-soft'}>
                      {step.replace(/^\d+\.\s*/, '')}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Verification Callout */}
          {safePlan?.verification && (
            <div className="border border-ok/30 bg-ok/5 p-3 text-small text-ink flex items-start gap-2">
              <span className="font-semibold text-ok shrink-0">✓ verify:</span>
              <span className="leading-relaxed">{safePlan.verification}</span>
            </div>
          )}

          {/* Why this action? */}
          <div className="border-t border-line pt-3 flex flex-col gap-1">
            <span className="text-label font-medium text-ink-faint">why this action</span>
            <p className="text-small text-ink-soft">
              {humanizeExplanation(safePlan?.reason || whyActionText, activeEvent?.scenario, activeEvent?.entity_id)}
            </p>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-line text-caption text-ink-faint flex-wrap gap-2">
            <span>
              confidence: <strong className="font-medium text-ink uppercase">{activeEvent?.confidence || 'HIGH'}</strong> — {safePlan?.evidence_status || 'Verified'}
            </span>
            <span>{safePlan?.source || 'TRACE Certified Safety Procedure Catalog'}</span>
          </div>
        </div>
      </section>

      {/* step 4 */}
      <section className="border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-small font-bold text-ink uppercase tracking-wide">
            Step 4: Pre-Execution Simulation
          </span>
          <span className="text-caption text-ink-faint">pre-execution verification</span>
        </div>
        <div className="p-5">
          {isCargoSimulationEligible ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-xl">
                <p className="text-small text-ink-soft">
                  TRACE can simulate the safer placement using the recorded video evidence. Before
                  touching the cargo, compare the current trajectory against alternatives.
                </p>
                <p className="mt-1 text-caption text-ink-faint">
                  Counterfactual simulation — a prediction, not a physical measurement.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSimulateSafer}
                className="inline-flex items-center gap-2 bg-ink px-4 py-2.5 text-small font-semibold text-paper transition-colors hover:bg-ink-soft"
              >
                <FlaskConical size={15} />
                simulate safer placement
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-xl">
                <p className="text-small font-medium text-ink">
                  procedural safety warning — no cargo trajectory to simulate
                </p>
                <p className="mt-1 text-caption text-ink-soft">
                  This scenario concerns worker positioning or environmental boundaries rather than
                  movable cargo. TRACE issues a direct procedural instruction and refuses to
                  fabricate package trajectories.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleSelectEvent(73)}
                className="inline-flex items-center gap-2 border border-signal bg-signal px-4 py-2 text-small font-semibold text-ink transition-colors hover:opacity-90"
              >
                test cargo demo (event #73)
              </button>
            </div>
          )}
        </div>
      </section>

      {/* technical disclosure */}
      <section className="border border-line bg-surface">
        <button
          type="button"
          onClick={() => setShowTechnical(!showTechnical)}
          className="flex w-full items-center justify-between px-4 py-3 text-small font-medium text-ink-soft transition-colors hover:text-ink"
        >
          <span>technical evidence &amp; mathematical formulation</span>
          <span className="font-mono text-caption">{showTechnical ? 'collapse' : 'expand'}</span>
        </button>

        {showTechnical && (
          <div className="flex flex-col gap-4 border-t border-line p-4">
            <div className="border border-line bg-paper p-3">
              <span className="text-label font-medium text-ink-soft">
                TRACE stability scoring formula (deterministic weights)
              </span>
              <pre className="mt-2 overflow-x-auto border border-line bg-surface p-2 font-mono text-caption text-ink">
                {'Stability Score = (0.40 × SupportOverlap) + (0.20 × Centering) + (0.20 × MassOrdering) + (0.20 × Orientation) − (0.25 × OverhangPenalty)'}
              </pre>
              <p className="mt-2 text-caption text-ink-faint">
                Bounded in [0, 100]. Scored identically across live video, what-if branches, and
                outcome verification frames.
              </p>
            </div>

            <div>
              <span className="text-label font-medium text-ink-soft">core safety scenario catalog</span>
              <div className="mt-1.5 divide-y divide-line border border-line bg-paper">
                {REFERENCE_SCENARIOS.map((sc) => (
                  <div key={sc.key} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                    <div>
                      <span className="text-small font-medium text-ink">{sc.title}</span>
                      <span className="ml-2 text-caption text-ink-faint">[{sc.lens}]</span>
                      <p className="mt-0.5 text-caption text-ink-soft">{sc.action}</p>
                    </div>
                    <span className="text-caption text-ink-faint">{sc.rationale}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-line bg-paper p-3 text-caption text-ink-soft">
              <span className="font-medium text-ink">sensor &amp; physical model disclaimers</span>
              <ul className="mt-1.5 list-inside list-disc space-y-1">
                <li>TRACE operates on 2D image-space telemetry; bounding boxes represent visual contours, not 3D point clouds.</li>
                <li>Mass ordering is estimated via SKU manifest metadata; tare weights and packaging center-of-gravity are uncalibrated.</li>
                <li>Recommendations are operational support directives, not automated actuator commands.</li>
              </ul>
            </div>
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
      <span className={`font-display text-display-md font-semibold tabular-nums ${valueCls}`}>{value}</span>
      <span className="text-caption text-ink-faint">{note}</span>
    </div>
  )
}
