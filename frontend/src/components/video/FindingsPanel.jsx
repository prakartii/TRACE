import { useState } from 'react'
import {
  getScenarioConfig,
  RISK_BAND_STYLES,
  STATUS_STYLES,
  EPISTEMIC_LEVELS,
  formatEvidenceKey,
  formatEvidenceValue,
} from '../../lib/scenarios.js'

function formatTimestamp(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return '00:00.0'
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`
}

export function getFindingPriorityScore(finding) {
  const statusWeights = {
    supported: 400,
    probable: 300,
    insufficient_evidence: 200,
    unsupported: 100,
  }
  const base = statusWeights[finding.status] || 0

  const scenarioWeights = {
    entity_in_dock_edge_zone: 95,
    stepping_on_carton: 90,
    carton_drop: 90,
    box_overhang: 85,
    pallet_overhang: 85,
    heavy_on_light_stacking: 85,
    unsupported_bending_placement: 80,
    dropping_or_throwing_precursor: 80,
    entity_in_wet_floor_zone: 75,
    stepping_on_carton_precursor: 75,
    wrong_product_orientation: 70,
    solo_heavy_handling: 70,
    dragging_precursor: 65,
    rolling_precursor: 65,
    straps_as_handles: 60,
    max_stack_height_exceeded: 55,
    box_displacement_near_person: 50,
    person_box_sustained_proximity: 45,
    image_space_support_hypothesis: 40,
    unplanned_loading_sequence: 35,
    wrong_equipment_usage: 35,
    product_rule_coverage: 20,
    product_conformance: 20,
  }
  const scenWeight = scenarioWeights[finding.scenario] || 30

  const confWeights = { High: 30, Medium: 20, Low: 10 }
  const confWeight = confWeights[finding.confidence] || 10

  return base + scenWeight + confWeight
}

function FindingCard({ finding, isPrimary = false, onSimulateWhatIf }) {
  const [showHowTraceKnows, setShowHowTraceKnows] = useState(false)
  const plan = finding.planner_recommendation
  const config = getScenarioConfig(finding.scenario)

  const isEligible = plan?.what_if_eligible ?? (
    config.whatIfEligible &&
    ['supported', 'probable'].includes(finding.status) &&
    ['structural', 'conformance'].includes(finding.lens)
  )

  const evidenceEntries = Object.entries(finding.evidence || {})
  const hasEvidence = evidenceEntries.length > 0 || plan?.basis

  // Effective presentation fields
  const riskBand = finding.band || config.defaultBand || 'Medium'
  const bandStyle = RISK_BAND_STYLES[riskBand] || RISK_BAND_STYLES.Medium
  const statusMeta = STATUS_STYLES[finding.status] || STATUS_STYLES.insufficient_evidence
  const epistemicMeta = EPISTEMIC_LEVELS[finding.epistemic_level] || EPISTEMIC_LEVELS.INFERRED

  const displayTitle = plan?.risk_title || config.title || finding.scenario?.replace(/_/g, ' ') || 'Observed Condition'
  const whatIsHappening = finding.explanation || config.whatIsHappening
  const whyItMatters = plan?.rationale || config.whyItMatters
  const safeAction = plan?.action || finding.recommended_action || config.recommendedAction
  const alternativeActions = plan?.alternative_actions?.length
    ? plan.alternative_actions
    : config.alternativeActions || []

  return (
    <div
      className={`border bg-white text-xs flex flex-col gap-3.5 shadow-sm transition-all ${
        isPrimary
          ? 'border-neutral-900 ring-1 ring-neutral-900/15 p-4.5'
          : 'border-line p-3.5 hover:border-neutral-400'
      }`}
    >
      {/* 1. Header: Risk Band, Status, Lens, Confidence */}
      <div className="flex items-center justify-between gap-2 border-b border-line pb-2.5 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {isPrimary && (
            <span className="bg-neutral-900 text-white font-bold text-[10px] uppercase tracking-wider px-2 py-0.5">
              ★ PRIMARY INCIDENT
            </span>
          )}
          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${bandStyle.subtle}`}>
            {bandStyle.label}
          </span>
          <span className={`border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${statusMeta.style}`}>
            {statusMeta.label}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-neutral-500 uppercase">
          <span className="bg-neutral-100 border border-line px-1.5 py-0.5 font-bold text-neutral-700">
            {finding.lens}
          </span>
          {finding.confidence && (
            <span>
              Certainty: <strong className="font-mono text-neutral-800">{finding.confidence}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Title */}
      <div>
        <h3 className="text-base font-bold text-neutral-900 tracking-tight leading-snug">
          {displayTitle}
        </h3>
      </div>

      {/* STEP 1: WHAT IS HAPPENING? */}
      <div className="flex flex-col gap-1 border-l-2 border-neutral-300 pl-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
          1. What Is Happening?
        </span>
        <p className="text-xs text-neutral-800 leading-relaxed font-sans">
          {whatIsHappening}
        </p>
        {finding.entities?.length > 0 && (
          <p className="text-[11px] text-neutral-500">
            Tracked Object: <span className="font-mono text-neutral-800 font-semibold">{finding.entities.join(', ')}</span>
          </p>
        )}
      </div>

      {/* STEP 2: WHY DOES IT MATTER? */}
      <div className="flex flex-col gap-1 border-l-2 border-amber-400 pl-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
          2. Why Does It Matter?
        </span>
        <p className="text-xs text-neutral-800 leading-relaxed font-sans">
          {whyItMatters}
        </p>
      </div>

      {/* STEP 3: WHAT SHOULD WE DO NOW? */}
      <div className="border border-emerald-300 bg-emerald-50/50 p-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[10px] uppercase tracking-wider text-emerald-950 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            <span>3. What Should We Do Now?</span>
          </span>
          <span className="text-[9.5px] font-bold text-emerald-900 uppercase bg-emerald-100/80 px-1.5 py-0.5 border border-emerald-300">
            Recommended Action
          </span>
        </div>
        <p className="font-bold text-neutral-950 text-xs leading-snug">
          "{safeAction}"
        </p>

        {/* Alternative Actions */}
        {alternativeActions.length > 0 && (
          <div className="mt-1 border-t border-emerald-200/70 pt-2 text-[11px] text-neutral-700">
            <span className="font-bold text-[10px] uppercase tracking-wider text-neutral-600 block mb-1">
              Alternative Options:
            </span>
            <ul className="list-disc list-inside space-y-0.5 text-neutral-600 pl-1">
              {alternativeActions.map((act, idx) => (
                <li key={idx}>{act}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* STEP 4: WHAT HAPPENS IF WE DO THAT? */}
      <div className="border border-line bg-neutral-50/80 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-700">
              4. What Happens If We Do That?
            </span>
            {isEligible ? (
              <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 border border-emerald-300 uppercase">
                What-If Available
              </span>
            ) : (
              <span className="text-[9px] font-semibold text-neutral-500 bg-neutral-200 px-1.5 py-0.5 uppercase">
                Procedural Intervention
              </span>
            )}
          </div>
          <p className="text-[11px] text-neutral-600 leading-snug font-sans">
            {isEligible
              ? 'TRACE has structured geometric evidence to simulate alternative placement stability before cargo is moved.'
              : config.whatIfNotice || 'Dynamic motion or environmental zone — physical retreat applies; cargo repositioning is not simulated.'}
          </p>
        </div>

        {isEligible && onSimulateWhatIf && (
          <button
            type="button"
            onClick={() => onSimulateWhatIf(finding)}
            className="border border-neutral-900 bg-neutral-900 hover:bg-neutral-800 text-white font-bold px-3 py-1.5 text-xs tracking-wide shadow-xs transition-colors cursor-pointer shrink-0"
          >
            Simulate Safer Placement →
          </button>
        )}
      </div>

      {/* STEP 5: HOW TRACE KNOWS (PROGRESSIVE DISCLOSURE) */}
      <div className="border-t border-line pt-2">
        <button
          type="button"
          onClick={() => setShowHowTraceKnows(!showHowTraceKnows)}
          className="w-full flex items-center justify-between text-[11px] text-neutral-600 hover:text-neutral-950 cursor-pointer py-1"
        >
          <span className="font-semibold flex items-center gap-1.5">
            <span>{showHowTraceKnows ? '▼' : '▶'}</span>
            <span>How TRACE Knows ({evidenceEntries.length} telemetry metric{evidenceEntries.length === 1 ? '' : 's'})</span>
          </span>
          <span className="text-[10px] text-neutral-500 font-normal uppercase tracking-wide">
            {showHowTraceKnows ? 'Hide Technical Evidence' : 'Audit Inspector for Judges'}
          </span>
        </button>

        {showHowTraceKnows && (
          <div className="mt-2.5 flex flex-col gap-3 bg-neutral-50 p-3.5 border border-line text-xs">
            {/* Epistemic Level Breakdown */}
            <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                Epistemic Classification
              </span>
              <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase border ${epistemicMeta.badge}`}>
                {finding.epistemic_level || 'INFERRED'}
              </span>
            </div>
            <p className="text-[11px] text-neutral-600 leading-snug">
              {epistemicMeta.desc}
            </p>

            {/* Evidence Metrics */}
            {hasEvidence && (
              <div className="border-t border-neutral-200 pt-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1.5">
                  Observed Computer Vision Telemetry
                </span>
                <ul className="flex flex-col gap-1 text-[11px] text-neutral-700 list-none pl-0">
                  {evidenceEntries.map(([key, val]) => (
                    <li key={key} className="flex items-center justify-between border-b border-dotted border-neutral-200 py-0.5">
                      <span className="text-neutral-600">{formatEvidenceKey(key)}:</span>
                      <span className="font-mono font-bold text-neutral-900 tabular-nums">
                        {formatEvidenceValue(key, val)}
                      </span>
                    </li>
                  ))}
                  {plan?.basis && (
                    <li className="text-[10px] text-neutral-500 mt-1 leading-snug">
                      <span className="font-medium text-neutral-700">Operational Basis: </span>
                      {plan.basis}
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Sensor & Epistemic Limitations */}
            {finding.limitations?.length > 0 && (
              <div className="border-t border-neutral-200 pt-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-0.5">
                  Sensor & Physics Limitations
                </span>
                <p className="text-[10px] text-neutral-600 leading-snug">
                  {finding.limitations.join('; ')}
                </p>
              </div>
            )}

            {/* Tracked Entities */}
            {finding.entities?.length > 0 && (
              <div className="border-t border-neutral-200 pt-1.5">
                <span className="text-[10px] text-neutral-500">
                  Tracked Entity Identifiers: <span className="font-mono text-neutral-800">{finding.entities.join(', ')}</span>
                </span>
              </div>
            )}

            {/* Raw Audit JSON */}
            <div className="border-t border-neutral-200 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">
                Raw Audit Event JSON
              </span>
              <pre className="max-h-36 overflow-auto bg-neutral-900 p-2.5 font-mono text-[10px] text-emerald-400 leading-tight border border-neutral-800">
                {JSON.stringify(
                  {
                    status: finding.status,
                    confidence: finding.confidence,
                    lens: finding.lens,
                    scenario: finding.scenario,
                    timestamp: finding.timestamp,
                    entities: finding.entities,
                    evidence: finding.evidence,
                    limitations: finding.limitations,
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
  )
}

export default function FindingsPanel({ findings, loading, error, currentTime = 0, onSimulateWhatIf }) {
  const [showOtherObservations, setShowOtherObservations] = useState(false)

  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (loading) {
    return (
      <div className="border border-line bg-white p-4 text-xs text-neutral-500 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="font-bold text-ink text-[11px] uppercase tracking-wider">
            Evaluating Risk Lenses for Frame {currentTime.toFixed(1)}s…
          </span>
        </div>
        <p className="text-[11px] text-neutral-400">
          Running 2D spatial graph and kinematic temporal analysis.
        </p>
      </div>
    )
  }

  if (!findings || findings.length === 0) {
    return (
      <div className="border border-line bg-neutral-50 p-4 text-xs text-neutral-500 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-neutral-400">
            ANALYSIS AT <span className="font-mono tabular-nums">{formatTimestamp(currentTime)} ({currentTime.toFixed(1)}s)</span>
          </span>
          <span className="text-emerald-700 font-bold text-[10px] uppercase">
            ✓ Normal Operation
          </span>
        </div>
        <p className="mt-1 text-neutral-600">
          No actionable risk or conformance findings detected in this frame.
        </p>
      </div>
    )
  }

  // Prioritize findings deterministically based on status, severity, and confidence
  const sortedFindings = [...findings].sort((a, b) => getFindingPriorityScore(b) - getFindingPriorityScore(a))
  const primaryFinding = sortedFindings[0]
  const secondaryFindings = sortedFindings.slice(1)

  return (
    <div className="flex flex-col gap-4">
      {/* Dynamic Frame Context Indicator */}
      <div className="flex items-center justify-between border border-line bg-neutral-50 px-3.5 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" />
          <span className="font-bold text-ink text-[11px] tracking-wide">
            ANALYSIS AT <span className="font-mono tabular-nums">{formatTimestamp(currentTime)} ({currentTime.toFixed(1)}s)</span>
          </span>
        </div>
        <span className="text-[10px] text-neutral-500">
          <span className="font-mono tabular-nums font-semibold text-neutral-800">{findings.length}</span> Finding{findings.length === 1 ? '' : 's'} Evaluated
        </span>
      </div>

      {/* Primary Action Card */}
      <div>
        <FindingCard
          finding={primaryFinding}
          isPrimary={true}
          onSimulateWhatIf={onSimulateWhatIf}
        />
      </div>

      {/* Secondary Observations (if multiple findings exist) */}
      {secondaryFindings.length > 0 && (
        <div className="border border-line bg-neutral-50 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[11px] text-neutral-700 uppercase tracking-wider">
              Other Observations at This Frame ({secondaryFindings.length})
            </span>
            <button
              onClick={() => setShowOtherObservations(!showOtherObservations)}
              className="text-[11px] font-semibold text-neutral-800 hover:underline cursor-pointer"
            >
              {showOtherObservations
                ? 'Collapse other observations'
                : `View ${secondaryFindings.length} other observation${secondaryFindings.length === 1 ? '' : 's'} →`}
            </button>
          </div>

          {showOtherObservations && (
            <div className="mt-2 flex flex-col gap-3 border-t border-neutral-200 pt-3">
              {secondaryFindings.map((finding, index) => (
                <FindingCard
                  key={index}
                  finding={finding}
                  isPrimary={false}
                  onSimulateWhatIf={onSimulateWhatIf}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
