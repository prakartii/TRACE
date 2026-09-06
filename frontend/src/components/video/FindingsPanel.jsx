import { useState } from 'react'

const STATUS_STYLE = {
  supported: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  probable: 'border-amber-300 bg-amber-50 text-amber-700',
  insufficient_evidence: 'border-line bg-neutral-100 text-neutral-600',
  unsupported: 'border-line bg-neutral-100 text-neutral-500',
}

const STATUS_LABEL = {
  supported: 'SUPPORTED FINDING',
  probable: 'PROBABLE FINDING',
  insufficient_evidence: 'INSUFFICIENT EVIDENCE',
  unsupported: 'UNSUPPORTED SCENARIO',
}

function formatTimestamp(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return '00:00.0'
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`
}

function StatusBadge({ status }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.insufficient_evidence
  const label = STATUS_LABEL[status] ?? status?.toUpperCase() ?? 'UNKNOWN'
  return (
    <span className={`border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${style}`}>
      {label}
    </span>
  )
}

function formatEvidenceItem(key, value) {
  const cleanKey = key.replace(/_/g, ' ')
  if (typeof value === 'number') {
    if (key.includes('ratio') || key.includes('fraction') || key.includes('overlap') || key.includes('percent')) {
      return { label: cleanKey, text: `${(value * 100).toFixed(1)}%` }
    }
    return { label: cleanKey, text: Number.isInteger(value) ? `${value}` : `${value.toFixed(2)}` }
  }
  if (typeof value === 'boolean') {
    return { label: cleanKey, text: value ? 'Yes' : 'No' }
  }
  if (typeof value === 'object' && value !== null) {
    return { label: cleanKey, text: JSON.stringify(value) }
  }
  return { label: cleanKey, text: String(value) }
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
    entity_in_dock_edge_zone: 90,
    box_overhang: 85,
    pallet_overhang: 85,
    heavy_on_light_stacking: 85,
    unsupported_bending_placement: 80,
    dropping_or_throwing_precursor: 80,
    entity_in_wet_floor_zone: 75,
    stepping_on_carton_precursor: 75,
    stepping_on_carton: 75,
    wrong_product_orientation: 70,
    solo_heavy_handling: 70,
    dragging_precursor: 65,
    rolling_precursor: 65,
    straps_as_handles: 60,
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
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false)
  const plan = finding.planner_recommendation
  const isEligible = plan?.what_if_eligible ?? (
    ['supported', 'probable'].includes(finding.status) &&
    ['structural', 'conformance'].includes(finding.lens)
  )

  const evidenceEntries = Object.entries(finding.evidence || {})
  const hasEvidence = evidenceEntries.length > 0 || plan?.basis

  const riskTitle = plan?.risk_title || finding.scenario?.replace(/_/g, ' ') || 'Observed Condition'

  const actionTheme = finding.status === 'supported'
    ? 'border-emerald-400 bg-emerald-50/70 text-emerald-950'
    : finding.status === 'probable'
      ? 'border-amber-400 bg-amber-50/70 text-amber-950'
      : 'border-line bg-neutral-50 text-neutral-800'

  return (
    <div
      className={`border bg-white text-xs flex flex-col gap-3 shadow-sm transition-all ${
        isPrimary
          ? 'border-emerald-600 ring-1 ring-emerald-500/20 p-4'
          : 'border-line p-3 hover:border-neutral-400'
      }`}
    >
      {/* Header: Priority Badge, Status, Lens, Confidence */}
      <div className="flex items-center justify-between gap-2 border-b border-line pb-2.5">
        <div className="flex items-center gap-2">
          {isPrimary && (
            <span className="bg-emerald-600 text-white font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 shadow-sm">
              ★ PRIMARY ACTION
            </span>
          )}
          <StatusBadge status={finding.status} />
          {finding.confidence && (
            <span className="text-[10px] font-mono text-neutral-500 uppercase">
              Conf: {finding.confidence}
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-600 bg-neutral-100 px-1.5 py-0.5 border border-line">
          {finding.lens}
        </span>
      </div>

      {/* 1. CURRENT OBSERVATION */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
          1. Current Observation
        </span>
        <p className="leading-relaxed text-neutral-900 bg-neutral-50 p-2.5 border border-line">
          {finding.explanation}
        </p>
        {finding.entities?.length > 0 && (
          <p className="text-[10px] text-neutral-500 font-mono">
            Tracked Entities: {finding.entities.join(', ')}
          </p>
        )}
      </div>

      {/* 2. RISK / CONDITION */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
          2. Risk / Condition
        </span>
        <h4 className="font-bold text-ink text-sm capitalize">
          {riskTitle}
        </h4>
      </div>

      {/* 3. WHY IT MATTERS */}
      {plan?.rationale && (
        <div className="flex flex-col gap-1 border-t border-neutral-100 pt-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            3. Why It Matters
          </span>
          <p className="text-[11px] leading-relaxed text-neutral-700">
            {plan.rationale}
          </p>
        </div>
      )}

      {/* 4. SAFE ACTION NOW */}
      {(plan?.action || finding.recommended_action) && (
        <div className={`border p-3 flex flex-col gap-2 ${actionTheme}`}>
          <div className="flex items-center justify-between">
            <span className="font-bold text-[10px] uppercase tracking-wider text-ink">
              4. Safe Action Now
            </span>
            {finding.status === 'supported' && (
              <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-wide bg-emerald-100 px-1 py-0.5">
                Immediate Precaution
              </span>
            )}
            {finding.status === 'probable' && (
              <span className="text-[9px] font-bold text-amber-800 uppercase tracking-wide bg-amber-100 px-1 py-0.5">
                Verification Required
              </span>
            )}
          </div>
          <p className="font-semibold text-ink leading-snug text-xs">
            {plan?.action || finding.recommended_action}
          </p>

          {/* 5. ALTERNATIVE ACTION */}
          {plan?.alternative_actions?.length > 0 && (
            <div className="mt-1 border-t border-neutral-200/60 pt-2 text-[11px] text-neutral-700">
              <span className="font-bold text-[10px] uppercase tracking-wider text-neutral-600 block mb-1">
                5. Alternative Actions:
              </span>
              <ul className="list-disc list-inside space-y-0.5 text-neutral-600">
                {plan.alternative_actions.map((act, idx) => (
                  <li key={idx}>{act}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 6. WHAT-IF COUNTERFACTUAL ACTION */}
          <div className="mt-2 pt-2 border-t border-neutral-200/80 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-neutral-800 block">
                {isEligible ? 'Placement Counterfactual Simulation' : 'Placement Simulation'}
              </span>
              <span className="text-[10px] text-neutral-600 block leading-snug">
                {isEligible
                  ? 'Simulation available — TRACE has enough structured evidence to compare an alternative placement.'
                  : 'Simulation unavailable — current evidence is not strong enough to safely simulate this intervention.'}
              </span>
            </div>
            {isEligible && onSimulateWhatIf && (
              <button
                onClick={() => onSimulateWhatIf(finding)}
                className="border border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1 text-[11px] tracking-wide shadow-sm transition-colors cursor-pointer shrink-0 ml-2"
              >
                Simulate What-If →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Progressive Disclosure: Technical Evidence, Sensor Limitations & Audit Data */}
      <div className="border-t border-line pt-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-neutral-600 font-medium">
            Evidence: {evidenceEntries.length} metric{evidenceEntries.length === 1 ? '' : 's'} · Visual tracking & spatial graph
          </span>
          <button
            type="button"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="text-[10px] font-mono text-neutral-600 hover:text-ink flex items-center gap-1 cursor-pointer"
          >
            <span>{showTechnicalDetails ? '▼' : '▶'}</span>
            <span>{showTechnicalDetails ? 'Hide technical evidence & audit details' : 'View technical evidence & audit details'}</span>
          </button>
        </div>

        {showTechnicalDetails && (
          <div className="mt-2 flex flex-col gap-2.5 bg-neutral-50 p-3 border border-line text-xs">
            {/* Evidence Metrics */}
            {hasEvidence && (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">
                  Observed Evidence Metrics
                </span>
                <ul className="flex flex-col gap-1 text-[11px] text-neutral-700 list-none pl-0">
                  {evidenceEntries.map(([key, val]) => {
                    const formatted = formatEvidenceItem(key, val)
                    return (
                      <li key={key} className="flex items-center justify-between border-b border-dotted border-neutral-200 py-0.5">
                        <span className="capitalize text-neutral-600">{formatted.label}:</span>
                        <span className="font-mono font-medium text-ink">{formatted.text}</span>
                      </li>
                    )
                  })}
                  {plan?.basis && (
                    <li className="text-[10px] text-neutral-500 mt-1 leading-snug">
                      <span className="font-medium">Operational basis: </span>{plan.basis}
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Limitations */}
            {finding.limitations?.length > 0 && (
              <div className="border-t border-neutral-200 pt-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-0.5">
                  Sensor & Epistemic Limitations
                </span>
                <p className="text-[10px] text-neutral-600 leading-snug">
                  {finding.limitations.join('; ')}
                </p>
              </div>
            )}

            {/* Tracked Entities */}
            {finding.entities?.length > 0 && (
              <div className="border-t border-neutral-200 pt-1.5">
                <span className="text-[10px] font-mono text-neutral-500">
                  Tracked Entity IDs: {finding.entities.join(', ')}
                </span>
              </div>
            )}

            {/* Raw Audit JSON */}
            <div className="border-t border-neutral-200 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">
                Raw Audit Event JSON
              </span>
              <pre className="max-h-40 overflow-auto bg-neutral-900 p-2.5 font-mono text-[10px] text-emerald-400 leading-tight border border-neutral-800">
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
          <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">
            ANALYSIS AT {formatTimestamp(currentTime)} ({currentTime.toFixed(1)}s)
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
      <div className="flex items-center justify-between border border-line bg-neutral-50 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" />
          <span className="font-mono font-bold text-ink text-[11px] tracking-wide">
            ANALYSIS AT {formatTimestamp(currentTime)} ({currentTime.toFixed(1)}s)
          </span>
        </div>
        <span className="text-[10px] font-mono text-neutral-500">
          {findings.length} Finding{findings.length === 1 ? '' : 's'} Evaluated
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
              className="text-[11px] font-medium text-blue-700 hover:underline cursor-pointer"
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
