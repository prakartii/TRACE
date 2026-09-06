import { useState } from 'react'
import { getFindingPriorityScore } from '../components/video/FindingsPanel.jsx'
import { useLiveViewContext } from '../LiveViewContext.jsx'

const SCENARIOS = [
  {
    key: 'heavy_on_light_stacking',
    title: 'Heavy-on-Light Stacking',
    lens: 'Structural',
    eligible: true,
    action: 'Move heavier load to a lower/base position and ensure adequate support.',
    rationale: 'Reverse-mass stacking creates carton crushing and stack instability risk.',
    basis: 'Image-space support edge + linked SKU mass class.',
  },
  {
    key: 'box_overhang',
    title: 'Box Overhang Cantilever',
    lens: 'Structural',
    eligible: true,
    action: 'Align upper carton with supporting package edges; eliminate base overhang.',
    rationale: 'Cantilever overhang creates eccentric loading and tipping hazard.',
    basis: 'Horizontal overlap ratio < 75% between supporting and supported cartons.',
  },
  {
    key: 'pallet_overhang',
    title: 'Pallet Overhang Cantilever',
    lens: 'Structural',
    eligible: true,
    action: 'Re-center the load within the available pallet support footprint.',
    rationale: 'Overhanging cartons risk impact with passing equipment and stack collapse.',
    basis: 'Horizontal overlap ratio < 75% on detected pallet runner.',
  },
  {
    key: 'unsupported_bending_placement',
    title: 'Unsupported Bending Placement',
    lens: 'Structural',
    eligible: true,
    action: 'Reposition the object so its support overlap is substantially improved.',
    rationale: 'Footprint support < 50% subjects the unsupported span to excessive bending.',
    basis: 'Horizontal support overlap ratio < 50%.',
  },
  {
    key: 'wrong_product_orientation',
    title: 'Wrong Product Orientation',
    lens: 'Conformance',
    eligible: true,
    action: 'Rotate the product to its required orientation.',
    rationale: 'Carton placed horizontally violates SKU vertical this-side-up requirement.',
    basis: 'Bounding box aspect ratio (w/h) vs operational SKU metadata.',
  },
  {
    key: 'dropping_or_throwing_precursor',
    title: 'Dropping / Throwing Precursor',
    lens: 'Behaviour',
    eligible: false,
    action: 'Slow the transfer and place the carton in a controlled trajectory.',
    rationale: 'Uncontrolled downward acceleration creates impact and damage risk.',
    basis: 'Consecutive downward velocity spike (>= 3 samples).',
  },
  {
    key: 'dragging_precursor',
    title: 'Carton Dragging Precursor',
    lens: 'Behaviour',
    eligible: false,
    action: 'Use an appropriate lifting/handling method instead of dragging.',
    rationale: 'Floor surface friction causes packaging abrasion and burst seams.',
    basis: 'Sustained horizontal movement near floor boundary plane.',
  },
  {
    key: 'entity_in_dock_edge_zone',
    title: 'Dock Edge Proximity Zone',
    lens: 'Environmental',
    eligible: false,
    action: 'Move the worker away from the hazardous dock/vehicle gap.',
    rationale: 'Unprotected worker presence in open dock threshold gap.',
    basis: 'Intersection with calibrated dock edge camera polygon.',
  },
  {
    key: 'entity_in_wet_floor_zone',
    title: 'Wet Floor Hazard Zone',
    lens: 'Environmental',
    eligible: false,
    action: 'Stop/redirect handling until calibrated wet-floor area is clear or controlled.',
    rationale: 'Slip and load-drop hazard on slick floor surfaces.',
    basis: 'Intersection with calibrated wet floor camera polygon.',
  },
]

// Status badge appearance (matches FindingsPanel epistemic scheme)
const STATUS_STYLES = {
  supported: {
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    card: 'border-emerald-400 bg-emerald-50/30',
    label: 'SUPPORTED',
  },
  probable: {
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    card: 'border-amber-400 bg-amber-50/30',
    label: 'PROBABLE',
  },
  insufficient_evidence: {
    badge: 'bg-neutral-200 text-neutral-600 border-neutral-300',
    card: 'border-neutral-300 bg-neutral-50',
    label: 'INSUFFICIENT EVIDENCE',
  },
  unsupported: {
    badge: 'bg-neutral-100 text-neutral-400 border-neutral-200',
    card: 'border-neutral-200 bg-neutral-50',
    label: 'UNSUPPORTED',
  },
}

function formatTimestamp(t) {
  if (typeof t !== 'number' || isNaN(t)) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * LiveFindingsSummary — the real-data section at the top of PlannerView.
 * Shows the ACTUAL backend findings from the currently-selected video + frame
 * as set by Live View. If Live View has nothing selected/analysed, shows a
 * clear directive to go to Live View first.
 */
function LiveFindingsSummary({ liveState }) {
  const { selectedId, selectedFilename, currentTime, findings, findingsLoading, findingsError, modelName } = liveState
  const [showTechDetails, setShowTechDetails] = useState(false)

  if (!selectedId) {
    return (
      <div className="border border-line bg-neutral-50 p-5 flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
          No Active Live View Analysis
        </span>
        <p className="text-xs text-neutral-600 leading-relaxed">
          Open <strong>Live View</strong>, select a video, enable{' '}
          <strong>Risk Findings</strong>, and scrub to a frame of interest. The Safe Action
          Planner will then display the TRACE-computed recommendation for that exact frame here.
        </p>
      </div>
    )
  }

  if (findingsLoading) {
    return (
      <div className="border border-line bg-white p-4 flex items-center gap-2 text-xs text-neutral-500">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
        <span>
          Evaluating risk lenses for <strong>{selectedFilename}</strong> at {currentTime.toFixed(1)}s…
        </span>
      </div>
    )
  }

  if (findingsError) {
    return (
      <div className="border border-red-300 bg-red-50 p-4 text-xs text-red-700">
        <strong>Error loading findings:</strong> {findingsError}
      </div>
    )
  }

  if (!findings) {
    return (
      <div className="border border-line bg-neutral-50 p-5 flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
          Risk Findings Not Enabled
        </span>
        <p className="text-xs text-neutral-600 leading-relaxed">
          In <strong>Live View</strong>, enable the{' '}
          <strong>Risk Findings</strong> toggle to start analysing{' '}
          <em>{selectedFilename}</em>. The planner will update automatically.
        </p>
      </div>
    )
  }

  if (findings.length === 0) {
    return (
      <div className="border border-emerald-300 bg-emerald-50/40 p-4 text-xs">
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono font-bold text-[10px] uppercase tracking-wide text-emerald-800">
            {selectedFilename} — {formatTimestamp(currentTime)} ({currentTime.toFixed(1)}s) — {modelName.toUpperCase()} model
          </span>
          <span className="text-emerald-700 font-bold text-[10px] uppercase">✓ Normal Operation</span>
        </div>
        <p className="text-neutral-600">No actionable risk or conformance findings at this frame.</p>
      </div>
    )
  }

  const sorted = [...findings].sort((a, b) => getFindingPriorityScore(b) - getFindingPriorityScore(a))
  const primary = sorted[0]
  const others = sorted.slice(1)
  const plan = primary.planner_recommendation

  const st = STATUS_STYLES[primary.status] ?? STATUS_STYLES.unsupported

  return (
    <div className="flex flex-col gap-3">
      {/* Frame context bar */}
      <div className="border border-line bg-neutral-50 px-3 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" />
          <span className="font-mono font-bold text-[11px] tracking-wide text-ink">
            {selectedFilename} — {formatTimestamp(currentTime)} ({currentTime.toFixed(1)}s)
          </span>
        </div>
        <span className="font-mono text-[10px] text-neutral-500">
          {findings.length} finding{findings.length === 1 ? '' : 's'} · {modelName.toUpperCase()} model
        </span>
      </div>

      {/* Primary finding action card */}
      <div className={`border p-4 flex flex-col gap-3 ${st.card}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              1. Detected Scenario
            </span>
            <span className="text-sm font-bold text-ink leading-snug">
              {plan?.risk_title ?? primary.scenario?.replace(/_/g, ' ')}
            </span>
          </div>
          <span className={`border text-[9px] font-bold px-2 py-0.5 uppercase tracking-wide shrink-0 ${st.badge}`}>
            {st.label}
          </span>
        </div>

        {/* Explanation */}
        {primary.explanation && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              2. What TRACE Observed
            </span>
            <p className="text-[11px] text-neutral-700 leading-relaxed">{primary.explanation}</p>
          </div>
        )}

        {/* Rationale */}
        {plan?.rationale && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              3. Why It Matters
            </span>
            <p className="text-[11px] text-neutral-700 leading-relaxed">{plan.rationale}</p>
          </div>
        )}

        {/* Safe Action */}
        {(plan?.action || primary.recommended_action) && (
          <div className={`border p-3 flex flex-col gap-1 ${st.card}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink">
                4. Safe Action Now
              </span>
              {primary.status === 'supported' && (
                <span className="text-[9px] font-bold text-emerald-800 uppercase bg-emerald-100 px-1 py-0.5">
                  Immediate Precaution
                </span>
              )}
              {primary.status === 'probable' && (
                <span className="text-[9px] font-bold text-amber-800 uppercase bg-amber-100 px-1 py-0.5">
                  Verification Required
                </span>
              )}
            </div>
            <p className="font-semibold text-ink text-xs leading-snug">
              {plan?.action ?? primary.recommended_action}
            </p>
            {plan?.alternative_actions?.length > 0 && (
              <ul className="list-disc list-inside mt-1 text-[11px] text-neutral-600 space-y-0.5">
                {plan.alternative_actions.map((alt, i) => (
                  <li key={i}>{alt}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 5. WHAT-IF COUNTERFACTUAL STATUS */}
        <div className="border border-neutral-200 bg-neutral-50/70 p-2.5 flex items-center justify-between text-xs">
          <div>
            <span className="font-bold text-[10px] uppercase tracking-wider text-neutral-500 block mb-0.5">
              5. Placement Simulation (What-If)
            </span>
            <p className="text-[11px] font-medium text-neutral-800">
              {plan?.what_if_eligible
                ? '✓ Simulation available — TRACE has enough structured evidence to compare an alternative placement.'
                : '✕ Simulation unavailable — current evidence is not strong enough to safely simulate this intervention.'}
            </p>
          </div>
          {plan?.what_if_eligible ? (
            <span className="border border-emerald-300 bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase px-2 py-0.5 shrink-0">
              Eligible
            </span>
          ) : (
            <span className="border border-neutral-300 bg-neutral-200 text-neutral-600 text-[10px] font-bold uppercase px-2 py-0.5 shrink-0">
              Procedural Only
            </span>
          )}
        </div>

        {/* Lens + confidence */}
        <div className="flex items-center gap-3 text-[10px] text-neutral-500 border-t border-neutral-200 pt-2">
          <span>Lens: <strong className="text-ink">{primary.lens?.toUpperCase()}</strong></span>
          <span>Confidence: <strong className="text-ink">{typeof primary.confidence === 'number' ? `${(primary.confidence * 100).toFixed(0)}%` : primary.confidence}</strong></span>
          <span>Scenario: <code className="font-mono text-neutral-700">{primary.scenario}</code></span>
        </div>

        {/* Evidence limitations */}
        {primary.limitations?.length > 0 && (
          <p className="text-[10px] text-neutral-400 leading-snug border-t border-neutral-200 pt-2">
            <span className="font-medium uppercase tracking-wider">Epistemic Limitations: </span>
            {primary.limitations.join('; ')}
          </p>
        )}

        {/* Progressive disclosure: Technical Evidence & Raw Audit JSON */}
        <div className="border-t border-neutral-200 pt-2">
          <button
            type="button"
            onClick={() => setShowTechDetails(!showTechDetails)}
            className="text-[10px] font-mono text-neutral-600 hover:text-ink flex items-center gap-1 cursor-pointer"
          >
            <span>{showTechDetails ? '▼' : '▶'}</span>
            <span>{showTechDetails ? 'Hide technical evidence & audit details' : 'View technical evidence & audit details'}</span>
          </button>

          {showTechDetails && (
            <div className="mt-2 flex flex-col gap-2.5 bg-neutral-50 p-3 border border-line text-xs">
              {primary.evidence && Object.keys(primary.evidence).length > 0 && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">
                    Evidence Key-Value Breakdown
                  </span>
                  <ul className="flex flex-col gap-1 text-[11px] text-neutral-700 list-none pl-0">
                    {Object.entries(primary.evidence).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between border-b border-dotted border-neutral-200 py-0.5">
                        <span className="capitalize text-neutral-600">{k.replace(/_/g, ' ')}:</span>
                        <span className="font-mono font-medium text-ink">
                          {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : String(v)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {primary.entities?.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono text-neutral-500">
                    Tracked Entities: {primary.entities.join(', ')}
                  </span>
                </div>
              )}

              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">
                  Raw Audit JSON
                </span>
                <pre className="max-h-40 overflow-auto bg-neutral-900 p-2.5 font-mono text-[10px] text-emerald-400 leading-tight border border-neutral-800">
                  {JSON.stringify(
                    {
                      status: primary.status,
                      confidence: primary.confidence,
                      lens: primary.lens,
                      scenario: primary.scenario,
                      timestamp: primary.timestamp,
                      entities: primary.entities,
                      evidence: primary.evidence,
                      limitations: primary.limitations,
                      planner_recommendation: primary.planner_recommendation,
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Secondary findings (collapsed summary) */}
      {others.length > 0 && (
        <div className="border border-line bg-neutral-50 p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-2">
            Other Observations at This Frame ({others.length})
          </span>
          <div className="flex flex-col gap-1">
            {others.map((f, i) => {
              const fst = STATUS_STYLES[f.status] ?? STATUS_STYLES.unsupported
              return (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-neutral-700">{f.scenario?.replace(/_/g, ' ')}</span>
                  <span className={`border text-[9px] font-bold px-1.5 py-0.5 uppercase ${fst.badge}`}>
                    {fst.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function PlannerView() {
  const { liveState } = useLiveViewContext()
  const [selectedScenario, setSelectedScenario] = useState(SCENARIOS[0])
  const [showRefMatrix, setShowRefMatrix] = useState(true)
  const [testOverlap, setTestOverlap] = useState(45)
  const [testCentering, setTestCentering] = useState(50)
  const [testMassOrder, setTestMassOrder] = useState('reverse') // 'reverse' | 'equal' | 'ideal'

  // Dynamic calculation of the TRACE Stability Score
  const massScore = testMassOrder === 'ideal' ? 100 : testMassOrder === 'equal' ? 85 : 0
  const overhangPenalty = Math.max(0, 100 - testOverlap)
  const rawScore = 0.40 * testOverlap + 0.20 * testCentering + 0.20 * massScore + 0.20 * 100 - 0.25 * overhangPenalty
  const calculatedScore = Math.round(Math.max(0, Math.min(100, rawScore)))

  const classification =
    calculatedScore >= 80
      ? 'High Geometric Support'
      : calculatedScore >= 60
        ? 'Moderate Geometric Support'
        : calculatedScore >= 40
          ? 'Weak Geometric Support'
          : 'Poor Geometric Support'

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-ink">Safe Action Planner</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Evaluates physical states, predicts unsafe placement configurations, and delivers specific safe actions before risks complete.
        </p>
      </div>

      {/* ── LIVE FINDINGS SECTION (HERO DECISION SURFACE) ────────────────────── */}
      <div className="border border-line bg-white p-4 flex flex-col gap-3 shadow-sm">
        <div className="flex items-center justify-between border-b border-line pb-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" />
              Live Frame Decision — Active Video Analysis
            </h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Computed dynamically for the frame currently active in Live View.
            </p>
          </div>
          <span className="border border-emerald-300 bg-emerald-50 text-emerald-800 text-[10px] font-bold uppercase px-2 py-0.5">
            Primary Decision Surface
          </span>
        </div>
        <LiveFindingsSummary liveState={liveState} />
      </div>

      {/* Epistemic Principles Banner */}
      <div className="border border-line bg-white p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
          Non-Negotiable Epistemic Decision Architecture
        </h2>
        <div className="grid grid-cols-4 gap-3 text-xs">
          <div className="border border-emerald-300 bg-emerald-50/50 p-2.5">
            <span className="font-bold text-emerald-800 uppercase text-[10px]">SUPPORTED</span>
            <p className="mt-1 text-emerald-950 font-medium">Direct Action</p>
            <p className="mt-0.5 text-[11px] text-emerald-700 leading-snug">
              Immediate operational precaution issued when multi-frame evidence clears all confidence gates.
            </p>
          </div>
          <div className="border border-amber-300 bg-amber-50/50 p-2.5">
            <span className="font-bold text-amber-800 uppercase text-[10px]">PROBABLE</span>
            <p className="mt-1 text-amber-950 font-medium">Verification Required</p>
            <p className="mt-0.5 text-[11px] text-amber-700 leading-snug">
              Evidence-based recommendation stating that physical verification is required before intervention.
            </p>
          </div>
          <div className="border border-neutral-300 bg-neutral-50 p-2.5">
            <span className="font-bold text-neutral-600 uppercase text-[10px]">INSUFFICIENT EVIDENCE</span>
            <p className="mt-1 text-neutral-900 font-medium">No Direct Instruction</p>
            <p className="mt-0.5 text-[11px] text-neutral-600 leading-snug">
              Explicitly notes that additional sensor evidence is required. What-If simulation safely refused.
            </p>
          </div>
          <div className="border border-neutral-300 bg-neutral-50 p-2.5">
            <span className="font-bold text-neutral-400 uppercase text-[10px]">UNSUPPORTED</span>
            <p className="mt-1 text-neutral-900 font-medium">Undetermined</p>
            <p className="mt-0.5 text-[11px] text-neutral-500 leading-snug">
              States TRACE cannot determine condition from available sensors. Never hallucinates claims.
            </p>
          </div>
        </div>
      </div>

      {/* Scenario Mapping & Interactive Stability Engine */}
      <div className="grid grid-cols-[1fr_380px] gap-6">
        {/* Scenarios Reference Library Table */}
        <div className="border border-line bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                TRACE Scenario & Action Reference Library ({SCENARIOS.length})
              </h2>
              <span className="text-[10px] text-neutral-400 block mt-0.5">
                Deterministic catalog — only scenarios supported by active visual evidence appear as live recommendations above.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowRefMatrix(!showRefMatrix)}
              className="text-[10px] font-mono text-neutral-500 hover:text-ink shrink-0 ml-2 cursor-pointer"
            >
              {showRefMatrix ? '▼ Hide library' : '▶ Show library'}
            </button>
          </div>

          <div className="border-l-2 border-neutral-400 bg-neutral-50 p-2.5 mb-3 text-[11px] text-neutral-600 leading-relaxed">
            <strong>Reference library</strong> — These are the deterministic scenario → action rules available to TRACE. Only scenarios supported by the current live evidence appear as active recommendations above. They are <em>not</em> all active risks for the current video.
          </div>

          {showRefMatrix && (
            <div className="flex flex-col gap-2 max-h-[560px] overflow-y-auto pr-1">
              {SCENARIOS.map((sc) => {
                const isSelected = selectedScenario.key === sc.key
                return (
                  <div
                    key={sc.key}
                    onClick={() => setSelectedScenario(sc)}
                    className={`cursor-pointer border p-3 transition-colors ${
                      isSelected ? 'border-ink bg-neutral-50' : 'border-line hover:border-neutral-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink text-xs">{sc.title}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-mono text-neutral-400">
                          {sc.lens}
                        </span>
                        {sc.eligible ? (
                          <span className="border border-emerald-300 bg-emerald-50 text-emerald-700 px-1.5 py-0.2 text-[9px] font-bold uppercase">
                            What-If Eligible
                          </span>
                        ) : (
                          <span className="text-[9px] text-neutral-400 uppercase">Procedural</span>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-neutral-700 font-medium">{sc.action}</p>
                    <p className="mt-0.5 text-[11px] text-neutral-500">{sc.rationale}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Interactive Stability Score Calculator */}
        <div className="border border-line bg-white p-4 flex flex-col gap-4">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Stability Scoring Engine
            </h2>
            <p className="mt-0.5 text-[11px] text-neutral-400">
              Interactive reference testbed for closed-form stability calculation.
            </p>
          </div>

          <div className="border border-line bg-neutral-50 p-3 text-center">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              TRACE Stability Score
            </span>
            <div className="text-4xl font-mono font-bold text-ink my-1">{calculatedScore}</div>
            <span className="inline-block border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-bold text-neutral-700">
              {classification}
            </span>
          </div>

          <div className="flex flex-col gap-3 text-xs">
            <div>
              <div className="flex justify-between text-neutral-600 mb-1">
                <span>Support Overlap (40% weight):</span>
                <span className="font-mono font-bold">{testOverlap}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={testOverlap}
                onChange={(e) => setTestOverlap(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-neutral-600 mb-1">
                <span>Centering Alignment (20% weight):</span>
                <span className="font-mono font-bold">{testCentering}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={testCentering}
                onChange={(e) => setTestCentering(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <span className="text-neutral-600 block mb-1">Mass Ordering (20% weight):</span>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => setTestMassOrder('reverse')}
                  className={`border py-1 text-[10px] font-medium ${
                    testMassOrder === 'reverse'
                      ? 'border-red-500 bg-red-50 text-red-700 font-bold'
                      : 'border-line bg-white text-neutral-600'
                  }`}
                >
                  Heavy on Light (0)
                </button>
                <button
                  type="button"
                  onClick={() => setTestMassOrder('equal')}
                  className={`border py-1 text-[10px] font-medium ${
                    testMassOrder === 'equal'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-bold'
                      : 'border-line bg-white text-neutral-600'
                  }`}
                >
                  Equal Mass (85)
                </button>
                <button
                  type="button"
                  onClick={() => setTestMassOrder('ideal')}
                  className={`border py-1 text-[10px] font-medium ${
                    testMassOrder === 'ideal'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-bold'
                      : 'border-line bg-white text-neutral-600'
                  }`}
                >
                  Light on Heavy (100)
                </button>
              </div>
            </div>

            <div className="border-t border-line pt-2 text-[11px] text-neutral-500 flex flex-col gap-1">
              <div className="flex justify-between">
                <span>Overhang Penalty (-25%):</span>
                <span className="font-mono text-red-600 font-medium">-{overhangPenalty}%</span>
              </div>
              <div className="flex justify-between">
                <span>Orientation Alignment (20%):</span>
                <span className="font-mono text-emerald-700 font-medium">+100%</span>
              </div>
            </div>
          </div>

          <p className="border-t border-line pt-2 text-[10px] text-neutral-400 leading-tight">
            * This score is an image-space decision-support metric, not a certified physical stability measurement.
          </p>
        </div>
      </div>
    </div>
  )
}
