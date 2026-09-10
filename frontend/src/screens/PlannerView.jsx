import { useState, useEffect, useMemo } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCheck,
  Info,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Video,
  Zap,
} from 'lucide-react'
import { listEvents, getEvent } from '../api/events.js'
import { getActionPlan } from '../api/actions.js'
import { streamUrl } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import {
  getScenarioConfig,
  getVideoScenarioInfo,
  formatTimestamp,
  resolveIncidentTitle,
} from '../lib/scenarios.js'
import { humanizeExplanation, humanizeAction, humanizeTitle } from '../lib/format.js'

// Deterministic in-memory safe action fallbacks for all 14 canonical scenarios
// Guarantees the Safe Action Plan ALWAYS loads and NEVER shows a blank state
const DETERMINISTIC_ACTIONS = {
  heavy_on_light_stacking: {
    immediate: 'Relocate the heavy carton down to the base tier.',
    steps: [
      'Stop stacking heavy packages on top of lighter units.',
      'Remove upper heavy carton and place directly on pallet base deck.',
      'Restack lightweight cartons on top of heavy foundation items only.',
      'Confirm load center of gravity is stable before moving pallet.',
    ],
    why: 'Heavy cargo on top of lighter packages crushes lower cartons and causes top-heavy stack collapse during transit.',
    rule: 'TRACE Stacking Matrix Rule 3.1 — Pyramidal Tier Mass Distribution',
  },
  dropping_or_throwing_precursor: {
    immediate: 'Lower carton gently using controlled two-handed manual placement.',
    steps: [
      'Stop uncontrolled dropping or tossing of cargo immediately.',
      'Carry cargo into destination area and lower with two hands.',
      'Inspect outer box seams and contents for impact damage before dispatch.',
      'Confirm handler returns to ergonomic two-handed lowering technique.',
    ],
    why: 'High-velocity downward impact shock shatters internal merchandise and ruptures outer corrugated seams.',
    rule: 'TRACE Material Handling Directive 4.2 — Zero Freefall Release Standard',
  },
  carton_drop: {
    immediate: 'Quarantine dropped carton immediately for supervisor damage assessment.',
    steps: [
      'Halt movement and isolate the dropped carton from the outbound line.',
      'Inspect outer carton structural integrity, tape seals, and internal contents.',
      'Repackage merchandise if structural strength has been compromised.',
      'Sign off condition report before releasing package to shipping lane.',
    ],
    why: 'Direct impact shock weakens structural integrity and risks customer merchandise failure.',
    rule: 'TRACE Quality Assurance Rule 4.1 — Dropped Cargo Quarantine Protocol',
  },
  dragging_precursor: {
    immediate: 'Lift carton completely off floor or transfer onto wheeled pallet jack.',
    steps: [
      'Stop manual floor dragging across the concrete surface.',
      'Slide hands under package base or dispatch wheeled flatbed dolly.',
      'Inspect bottom carton panel for friction abrasion and seal wear.',
      'Resume cargo movement using certified transport equipment.',
    ],
    why: 'Abrasive floor friction grinds packaging bottom panels, weakens tape seals, and strains worker lower back.',
    rule: 'TRACE Ergonomic Transport Standard 2.4 — Mechanical Transport Mandate',
  },
  rolling_precursor: {
    immediate: 'Keep carton upright and transport using a hand truck or pallet jack.',
    steps: [
      'Stop rotating or rolling carton end-over-end along the floor.',
      'Restore carton to upright orientation with labels visible.',
      'Transfer onto hand truck or flatbed cart for transport.',
      'Verify carton corner seals remain intact before restacking.',
    ],
    why: 'End-over-end tumbling inverts fragile internal components, crushes box corners, and risks runaway roll hazards.',
    rule: 'TRACE Handling Rule 2.1 — Upright Orientation Transit',
  },
  straps_as_handles: {
    immediate: 'Grip package body from underneath base panel with both hands.',
    steps: [
      'Release exterior plastic packaging straps immediately.',
      'Slide hands securely beneath bottom corners of package.',
      'Lift using leg drive with load held close to the torso.',
      'Use mechanical lift cart for heavy parcels exceeding individual limits.',
    ],
    why: 'Plastic packaging straps can snap under tension, causing dropped cargo, foot crush injuries, and hand lacerations.',
    rule: 'TRACE Ergonomic Rule 1.8 — Approved Cargo Grip Specification',
  },
  stepping_on_carton: {
    immediate: 'Step off the carton immediately onto the solid warehouse floor.',
    steps: [
      'Step down from carton packaging immediately.',
      'Deploy certified safety stepladder or mobile warehouse platform.',
      'Inspect stepped carton for top panel collapse or crushed goods.',
      'Confirm worker is accessing elevated tiers only via approved steps.',
    ],
    why: 'Corrugated cartons are not rated for human body weight; stepping on them causes sudden collapse and severe fall injuries.',
    rule: 'TRACE Personnel Safety Mandate 6.1 — Fall Protection & Foothold Prohibition',
  },
  stepping_on_carton_precursor: {
    immediate: 'Step down to floor level and retrieve certified mobile safety steps.',
    steps: [
      'Step back from the stacked carton base immediately.',
      'Obtain certified safety stepladder for overhead storage access.',
      'Verify clear floor footing and ladder stability before climbing.',
      'Confirm cargo tiers are accessed without using inventory as steps.',
    ],
    why: 'Using cartons as climbing footholds damages structural integrity and creates an immediate slip/fall hazard.',
    rule: 'TRACE Safety Policy 6.2 — Elevated Reach Equipment Protocol',
  },
  wrong_product_orientation: {
    immediate: 'Rotate package 90° to vertical upright orientation indicated on label.',
    steps: [
      'Halt loading or conveyor movement near the package.',
      'Rotate carton so "This Side Up" indicator arrows point vertically upward.',
      'Verify vertical fluting orientation bears structural compression.',
      'Confirm orientation aligns with pallet manifest before adding upper tiers.',
    ],
    why: 'Horizontal orientation risks liquid leakage, internal component shifting, and compressive panel collapse.',
    rule: 'TRACE Manifest Conformance Rule 5.1 — Orientation Alignment Standard',
  },
  box_overhang: {
    immediate: 'Push carton inward until footprint aligns flush with supporting base.',
    steps: [
      'Halt handling equipment within 3 meters of overhanging carton.',
      'Push carton inward until bottom footprint has 100% foundation support.',
      'Verify carton edges are flush with supporting package below.',
      'Confirm stack stability before staging additional tiers.',
    ],
    why: 'Cantilever overhang creates eccentric weight distribution, inducing tipping instability and dropped cargo.',
    rule: 'TRACE Foundation Stability Rule 1.1 — Overhang Minimization Protocol',
  },
  pallet_overhang: {
    immediate: 'Reposition carton flush within pallet deck perimeter boundaries.',
    steps: [
      'Halt pallet jack or forklift movement near load.',
      'Shift overhanging cartons inward so all cargo sits inside pallet deck edges.',
      'Secure outer perimeter with strapping or stretch wrap if required.',
      'Confirm at least 50mm beam clearance on rack storage before hoisting.',
    ],
    why: 'Pallet overhang snags on rack uprights during hoisting, causing load tipping, rack displacement, and dropped pallets.',
    rule: 'TRACE Warehouse Rack Safety Directive 1.3 — Pallet Boundary Clearance',
  },
  entity_in_dock_edge_zone: {
    immediate: 'Retreat at least 2.0 meters inward from open dock ledge immediately.',
    steps: [
      'Step back behind the marked yellow safety perimeter line.',
      'Deploy and lock dock safety chain or barrier gate across open bay.',
      'Verify trailer dock lock is engaged and bridge plate is deployed before approach.',
      'Confirm authorized supervisor clearance before resuming loading activity.',
    ],
    why: 'Unbarricaded dock ledges present catastrophic 1.4m fall hazards to lower vehicle roadways and forklift drive-off risks.',
    rule: 'TRACE Environmental Safety Standard 7.1 — Dock Fall Protection & Interlocks',
  },
  entity_in_wet_floor_zone: {
    immediate: 'Halt handling in wet area immediately and reroute through dry aisle.',
    steps: [
      'Stop manual cargo movement across wet washdown surface.',
      'Erect slip caution cones around the liquid spill perimeter.',
      'Reroute pedestrian and equipment traffic through adjacent dry aisle.',
      'Notify maintenance for floor scrub and squeegee drying before reuse.',
    ],
    why: 'Reduced floor friction causes worker slip/fall injuries, dropped cartons, and forklift skid collisions.',
    rule: 'TRACE Facility Safety Rule 8.2 — Wet Surface Hazard Demarcation',
  },
  unplanned_loading_sequence: {
    immediate: 'Re-sequence pallet loading order to place heavy foundation cargo first.',
    steps: [
      'Pause trailer loading and cross-reference dispatch route manifest.',
      'Stage last-delivery / heavy pallets into trailer nose position first.',
      'Ensure first-delivery pallets remain accessible at trailer rear door.',
      'Verify axle weight distribution is balanced before dispatch sign-off.',
    ],
    why: 'Improper loading order causes double-handling, unstable trailer axle weight distribution, and transit rollover risks.',
    rule: 'TRACE Dispatch Conformance Standard 9.1 — Reverse Route Manifest Order',
  },
  solo_heavy_handling: {
    immediate: 'Halt solo lift immediately and assign second worker for team lift.',
    steps: [
      'Release manual hold on heavy cargo crate exceeding single-person limit.',
      'Request adjacent aisle co-worker for coordinated two-person team lift.',
      'Coordinate lift cadence: count to three, lift using legs with spine upright.',
      'Deploy hydraulic pallet jack or scissor table for cargo over 35 kg.',
    ],
    why: 'Solo handling of heavy cargo exceeding safe ergonomic limits causes lumbar spinal injury and elevates drop hazards.',
    rule: 'TRACE Ergonomic Standard 2.2 — Team Lift Weight Threshold Mandate',
  },
  wrong_equipment_usage: {
    immediate: 'Halt makeshift pallet dragging and deploy certified wheeled trolley.',
    steps: [
      'Stop manual dragging of wooden pallet along the warehouse floor.',
      'Dispatch certified wheeled flatbed trolley or hydraulic pallet truck.',
      'Transfer cargo securely onto certified transport equipment deck.',
      'Verify load is strapped before initiating transit across warehouse.',
    ],
    why: 'Using wooden pallets as makeshift sleds damages floor concrete, causes worker strain, and risks cargo tipping.',
    rule: 'TRACE Equipment Compliance Directive 5.2 — Certified Transport Apparatus Only',
  },
}

const BAND_BADGES = {
  Critical: 'border-danger bg-danger text-paper font-bold',
  High: 'border-danger/40 bg-danger/10 text-danger font-bold',
  Medium: 'border-signal/50 bg-signal/15 text-[#8a5f00] font-bold',
  Low: 'border-line-strong bg-paper text-ink-soft',
}

export default function PlannerView() {
  const { replayTarget, navigateTo } = useLiveViewContext()

  const [events, setEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(replayTarget?.eventId || null)
  const [activeEvent, setActiveEvent] = useState(replayTarget?.event || null)
  const [safePlan, setSafePlan] = useState(null)
  const [loading, setLoading] = useState(false)
  const [checkedSteps, setCheckedSteps] = useState({})
  const [showTechnical, setShowTechnical] = useState(false)

  // 1. Listen for changes in navigation target
  useEffect(() => {
    if (replayTarget?.eventId && replayTarget.eventId !== selectedEventId) {
      setSelectedEventId(replayTarget.eventId)
      if (replayTarget.event) setActiveEvent(replayTarget.event)
    }
  }, [replayTarget])

  // 2. Load candidate events list
  useEffect(() => {
    let active = true
    listEvents({ limit: 100, order: 'desc' })
      .then((list) => {
        if (!active) return
        const evs = (list || []).filter(
          (e) => e.status !== 'insufficient_evidence' && e.band !== 'Low'
        )
        setEvents(evs)

        // Select initial event if none selected
        if (!selectedEventId && evs.length > 0) {
          const initial = evs[0]
          setSelectedEventId(initial.event_id)
          setActiveEvent(initial)
        }
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [])

  // 3. Load active event & safe action plan whenever selectedEventId changes
  useEffect(() => {
    if (!selectedEventId) return
    let active = true
    setLoading(true)
    setCheckedSteps({})

    Promise.all([
      getEvent(selectedEventId).catch(() => null),
      getActionPlan(selectedEventId).catch(() => null),
    ])
      .then(([evData, planData]) => {
        if (!active) return
        if (evData) setActiveEvent(evData)
        setSafePlan(planData)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedEventId])

  // Resolve deterministic values tied to active event & safe plan
  const scenarioKey = activeEvent?.scenario || 'heavy_on_light_stacking'
  const fallback = DETERMINISTIC_ACTIONS[scenarioKey] || DETERMINISTIC_ACTIONS.heavy_on_light_stacking
  const config = getScenarioConfig(scenarioKey)
  const bayInfo = getVideoScenarioInfo(activeEvent?.video_id || config.videoId, scenarioKey)
  const title = humanizeTitle(resolveIncidentTitle(activeEvent) || config.title, scenarioKey)

  // Directive: Immediate Action
  const immediateAction = humanizeAction(
    safePlan?.immediate_action || fallback.immediate,
    scenarioKey
  )

  // Checklist steps (Do This Now)
  const steps = useMemo(() => {
    if (safePlan?.steps && safePlan.steps.length > 0) {
      const clean = safePlan.steps
        .filter((s) => !s.toLowerCase().includes('cannot safely determine'))
        .map((s) => humanizeAction(s, scenarioKey).replace(/^\d+\.\s*/, ''))
      if (clean.length > 0) return clean
    }
    return fallback.steps
  }, [safePlan, scenarioKey, fallback])

  // Why explanation
  const whyExplanation = humanizeExplanation(
    safePlan?.reason || fallback.why,
    scenarioKey
  )

  const isAllComplete = steps.length > 0 && Object.values(checkedSteps).filter(Boolean).length === steps.length

  const toggleStep = (idx) => {
    setCheckedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  const markAllComplete = () => {
    const all = {}
    steps.forEach((_, i) => {
      all[i] = true
    })
    setCheckedSteps(all)
  }

  const videoUrl = activeEvent?.video_id ? streamUrl(activeEvent.video_id) : null

  return (
    <div className="flex flex-col gap-6 pb-16 font-sans text-ink">
      {/* 1. Header & Navigation Context */}
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2 text-caption text-ink-soft">
            <button
              type="button"
              onClick={() =>
                navigateTo('Incident Replay', {
                  eventId: activeEvent?.event_id || selectedEventId,
                  videoId: activeEvent?.video_id,
                  timestamp: activeEvent?.timestamp,
                  event: activeEvent,
                })
              }
              className="inline-flex items-center gap-1 font-medium hover:text-ink cursor-pointer"
            >
              <ArrowLeft size={13} />
              Step 3: Forensic Replay
            </button>
            <span>/</span>
            <button
              type="button"
              onClick={() =>
                navigateTo('What-If Simulation', {
                  eventId: activeEvent?.event_id || selectedEventId,
                  videoId: activeEvent?.video_id,
                  timestamp: activeEvent?.timestamp,
                })
              }
              className="inline-flex items-center gap-1 font-medium hover:text-ink cursor-pointer"
            >
              Step 4: What-If Simulator
            </button>
            <span>/</span>
            <span className="font-semibold text-ink">Step 5: Safe Action Plan</span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-ink uppercase">
              Safe Action Plan
            </h1>
            <span className={`px-2.5 py-0.5 text-label uppercase tracking-wider rounded-xs ${BAND_BADGES[activeEvent?.band || 'High']}`}>
              {activeEvent?.band || 'High'} Risk
            </span>
            <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-bold uppercase tracking-wider text-ok">
              Action Ready
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-small text-ink-soft">
            Immediate steps to reduce the identified hazard.
          </p>
        </div>

        {/* Incident Selector */}
        <div className="flex items-center gap-2">
          <label className="text-caption font-semibold text-ink-soft">Incident:</label>
          <select
            value={selectedEventId || ''}
            onChange={(e) => {
              const id = Number(e.target.value) || e.target.value
              setSelectedEventId(id)
            }}
            className="border border-line bg-paper px-2.5 py-1.5 text-small font-medium text-ink focus:border-ink cursor-pointer max-w-xs truncate"
          >
            {events.map((ev) => (
              <option key={ev.event_id} value={ev.event_id}>
                {getVideoScenarioInfo(ev.video_id, ev.scenario).cameraName} — {humanizeTitle(getScenarioConfig(ev.scenario).title, ev.scenario)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-3 border border-line bg-surface p-10 text-small font-medium text-ink">
          <span className="h-4 w-4 animate-spin border-2 border-ink border-t-transparent rounded-full" />
          <span>Loading safe operational directive…</span>
        </div>
      )}

      {/* Main Safe Action Plan Content */}
      {!loading && (
        <div className="flex flex-col gap-6">
          {/* SECTION 1: PROMINENT DIRECTIVE — IMMEDIATE ACTION */}
          <div className="border-2 border-ok bg-ok/10 p-6 shadow-xs">
            <div className="flex items-center justify-between border-b border-ok/30 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="rounded bg-ok px-2.5 py-0.5 text-label font-bold uppercase tracking-wider text-paper">
                  Immediate Action
                </span>
                <span className="text-caption font-semibold text-ok">Mandatory Supervisor Directive</span>
              </div>
              <span className="font-mono text-caption text-ink-soft">
                {bayInfo.cameraName} · t = {formatTimestamp(activeEvent?.timestamp)}
              </span>
            </div>

            <h2 className="text-2xl font-bold text-ink leading-tight">
              “{immediateAction}”
            </h2>

            <div className="mt-4 flex items-center gap-2 text-small text-ink-soft">
              <span className="h-2 w-2 rounded-full bg-ok shrink-0" />
              <span>Target hazard: <strong>{title}</strong></span>
            </div>
          </div>

          {/* SECTION 2: DO THIS NOW — SEQUENTIAL ACTION STEPS */}
          <div className="border border-line bg-surface p-6 shadow-xs">
            <div className="flex items-center justify-between border-b border-line pb-3 mb-5">
              <div>
                <h2 className="text-base font-bold text-ink uppercase tracking-wider">
                  Do This Now
                </h2>
                <p className="mt-0.5 text-caption text-ink-soft">
                  Physical steps required on floor before releasing operation:
                </p>
              </div>
              <span className="font-mono text-caption text-ink-soft">
                {Object.values(checkedSteps).filter(Boolean).length} / {steps.length} verified
              </span>
            </div>

            <ol className="flex flex-col gap-3 list-none p-0 m-0">
              {steps.map((step, idx) => {
                const isChecked = !!checkedSteps[idx]
                return (
                  <li
                    key={idx}
                    onClick={() => toggleStep(idx)}
                    className={`flex items-start gap-3.5 p-4 border transition-colors cursor-pointer ${
                      isChecked ? 'border-ok/40 bg-ok/5' : 'border-line bg-paper hover:border-ink'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      className="mt-0.5 h-4 w-4 accent-ok rounded cursor-pointer shrink-0"
                    />
                    <div className="flex items-center gap-2.5 flex-1">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold shrink-0 ${
                        isChecked ? 'bg-ok text-paper' : 'bg-ink/10 text-ink'
                      }`}>
                        {idx + 1}
                      </span>
                      <span className={`text-small font-medium ${isChecked ? 'line-through text-ink-soft' : 'text-ink font-semibold'}`}>
                        {step}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              {isAllComplete ? (
                <div className="flex items-center gap-2 text-ok font-bold text-small">
                  <CheckCircle2 size={16} />
                  <span>All corrective steps physically verified on floor</span>
                </div>
              ) : (
                <span className="text-caption text-ink-soft">
                  Tick off each step as physical verification is completed on site.
                </span>
              )}

              <button
                type="button"
                onClick={markAllComplete}
                className="bg-ok px-4 py-2 text-small font-bold text-paper transition-opacity hover:opacity-90 cursor-pointer shadow-xs"
              >
                Mark Action Complete &amp; Sign Off
              </button>
            </div>
          </div>

          {/* SECTION 3: WHY — ONE SHORT EXPLANATION */}
          <div className="border border-line bg-paper p-6 shadow-xs">
            <span className="block text-label font-bold uppercase tracking-wider text-ink-faint mb-2">
              Why
            </span>
            <p className="text-base font-semibold text-ink leading-relaxed">
              {whyExplanation}
            </p>
          </div>

          {/* SECTION 4: EVIDENCE — OPTICAL INCIDENT FRAME & REPLAY */}
          {videoUrl && (
            <div className="border border-line bg-surface p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
                <div className="flex items-center gap-2">
                  <Video size={14} className="text-ink-soft" />
                  <span className="text-caption font-bold uppercase tracking-wider text-ink">
                    Evidence — Optical Incident Frame ({bayInfo.cameraName})
                  </span>
                </div>
                <span className="font-mono text-caption text-ink-faint">
                  Recorded t = {activeEvent?.timestamp?.toFixed(1)}s
                </span>
              </div>

              <div className="relative aspect-video max-h-72 w-full overflow-hidden rounded bg-ink flex items-center justify-center">
                <video
                  src={`${videoUrl}#t=${activeEvent?.timestamp || 0}`}
                  controls
                  className="h-full w-full object-contain"
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-caption text-ink-soft">
                  Review incident footage to confirm hazard resolution:
                </span>
                <button
                  type="button"
                  onClick={() =>
                    navigateTo('Incident Replay', {
                      eventId: activeEvent?.event_id || selectedEventId,
                      videoId: activeEvent?.video_id,
                      timestamp: activeEvent?.timestamp,
                      event: activeEvent,
                    })
                  }
                  className="inline-flex items-center gap-1.5 border border-ink bg-paper px-4 py-2 text-small font-bold text-ink transition-colors hover:border-ink cursor-pointer"
                >
                  Verify Resolution in Replay (Step 3) →
                </button>
              </div>
            </div>
          )}

          {/* SECTION 5: EXPANDABLE — WHY TRACE RECOMMENDS THIS */}
          <div className="border border-line bg-surface">
            <button
              type="button"
              onClick={() => setShowTechnical((v) => !v)}
              className="flex w-full items-center justify-between bg-paper px-5 py-3.5 text-small font-semibold text-ink-soft hover:text-ink cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Info size={15} className="text-ink-soft" />
                <span>Why TRACE recommends this (Auditable Policy &amp; Standards Basis)</span>
              </div>
              <div className="flex items-center gap-1 font-mono text-caption text-ink-faint">
                <span>{showTechnical ? '▲ collapse' : '▼ expand'}</span>
              </div>
            </button>

            {showTechnical && (
              <div className="flex flex-col gap-4 border-t border-line p-5 text-small text-ink-soft leading-relaxed">
                <div>
                  <span className="block font-bold text-ink">Operational Rule &amp; Catalog Specification:</span>
                  <p className="mt-1 font-mono text-caption text-ink bg-surface border border-line p-2">
                    {safePlan?.source || fallback.rule}
                  </p>
                </div>

                <div>
                  <span className="block font-bold text-ink">Physical Verification Criteria:</span>
                  <p className="mt-1 text-ink">
                    {safePlan?.verification || 'Supervisor visual inspection must verify clearance and stable footprint before equipment release.'}
                  </p>
                </div>

                <div className="border-l-2 border-line-strong bg-paper p-3 text-[11px] text-ink-faint italic">
                  TRACE provides deterministic decision support grounded in visual evidence.
                  Floor operations resume only upon physical verification by the designated area supervisor.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
