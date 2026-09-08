import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import {
  getScenarioConfig,
  RISK_BAND_STYLES,
  STATUS_STYLES,
  EPISTEMIC_LEVELS,
  formatEvidenceKey,
  formatEvidenceValue,
  telemetryEntries,
} from '../../lib/scenarios.js'
import SupervisorRuleNotice from '../SupervisorRuleNotice.jsx'

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

  const evidenceEntries = telemetryEntries(finding.evidence)
  const hasEvidence = evidenceEntries.length > 0 || plan?.basis

  const riskBand = finding.band || config.defaultBand || 'Medium'
  const bandStyle = RISK_BAND_STYLES[riskBand] || RISK_BAND_STYLES.Medium
  const statusMeta = STATUS_STYLES[finding.status] || STATUS_STYLES.insufficient_evidence
  const epistemicMeta = EPISTEMIC_LEVELS[finding.epistemic_level] || EPISTEMIC_LEVELS.INFERRED

  const displayTitle = plan?.risk_title || config.title || finding.scenario?.replace(/_/g, ' ') || 'Observed condition'
  const whatIsHappening = finding.explanation || config.whatIsHappening
  const whyItMatters = plan?.rationale || config.whyItMatters
  const safeAction = plan?.action || finding.recommended_action || config.recommendedAction
  const alternativeActions = plan?.alternative_actions?.length
    ? plan.alternative_actions
    : config.alternativeActions || []

  return (
    <div
      className={`flex flex-col gap-3.5 border bg-surface ${
        isPrimary ? 'border-ink p-4' : 'border-line p-3.5'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {isPrimary && (
            <span className="bg-ink px-2 py-0.5 text-label font-medium text-paper">primary finding</span>
          )}
          <span className={`border px-2 py-0.5 text-label font-medium ${bandStyle.subtle}`}>
            {bandStyle.label}
          </span>
          <span className={`border px-1.5 py-0.5 text-label font-medium ${statusMeta.style}`}>
            {statusMeta.label}
          </span>
        </div>
        <div className="flex items-center gap-2 text-caption text-ink-soft">
          <span className="border border-line bg-paper px-1.5 py-0.5 text-label text-ink-soft">
            {finding.lens}
          </span>
          {finding.confidence && (
            <span>
              certainty: <span className="font-mono text-ink">{finding.confidence}</span>
            </span>
          )}
        </div>
      </div>

      <h3 className="font-display text-display-md font-semibold leading-tight text-ink">{displayTitle}</h3>

      <div className="flex flex-col gap-1 border-l-2 border-line pl-3">
        <span className="text-label font-medium text-ink-faint">1. what is happening</span>
        <p className="text-small text-ink">{whatIsHappening}</p>
        {finding.entities?.length > 0 && (
          <p className="text-caption text-ink-faint">
            tracked object: <span className="font-mono text-ink-soft">{finding.entities.join(', ')}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1 border-l-2 border-signal pl-3">
        <span className="text-label font-medium text-[#8a5f00]">2. why it matters</span>
        <p className="text-small text-ink">{whyItMatters}</p>
      </div>

      <div className="flex flex-col gap-2 border border-ok/40 bg-ok/5 p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-label font-medium text-ok">3. what to do now</span>
          <span className="border border-ok/40 bg-ok/10 px-1.5 py-0.5 text-label text-ok">
            recommended action
          </span>
        </div>
        <p className="text-small font-semibold text-ink">"{safeAction}"</p>

        {alternativeActions.length > 0 && (
          <div className="mt-1 border-t border-ok/20 pt-2">
            <span className="block text-label font-medium text-ink-soft">alternative options</span>
            <ul className="mt-1 list-inside list-disc space-y-0.5 pl-1 text-caption text-ink-soft">
              {alternativeActions.map((act, idx) => (
                <li key={idx}>{act}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-col justify-between gap-3 border border-line bg-paper p-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-label font-medium text-ink-soft">4. what happens if we act</span>
            {isEligible ? (
              <span className="border border-ok/40 bg-ok/10 px-1.5 py-0.5 text-label text-ok">what-if available</span>
            ) : (
              <span className="border border-line px-1.5 py-0.5 text-label text-ink-faint">procedural intervention</span>
            )}
          </div>
          <p className="mt-0.5 text-caption text-ink-soft">
            {isEligible
              ? 'TRACE has structured geometric evidence to simulate alternative placement stability before the load is moved.'
              : config.whatIfNotice || 'Dynamic motion or environmental zone — physical retreat applies; repositioning is not simulated.'}
          </p>
        </div>

        {isEligible && onSimulateWhatIf && (
          <button
            type="button"
            onClick={() => onSimulateWhatIf(finding)}
            className="inline-flex shrink-0 items-center gap-1.5 border border-ink bg-ink px-3 py-1.5 text-caption font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            simulate safer placement
            <ArrowRight size={13} />
          </button>
        )}
      </div>

      <div className="border-t border-line pt-2">
        <button
          type="button"
          onClick={() => setShowHowTraceKnows(!showHowTraceKnows)}
          className="flex w-full items-center justify-between py-1 text-caption text-ink-soft hover:text-ink"
        >
          <span className="font-medium">
            how TRACE knows ({evidenceEntries.length} telemetry metric{evidenceEntries.length === 1 ? '' : 's'})
          </span>
          <span className="font-mono">{showHowTraceKnows ? '−' : '+'}</span>
        </button>

        {showHowTraceKnows && (
          <div className="mt-2.5 flex flex-col gap-3 border border-line bg-paper p-3.5">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-label font-medium text-ink-soft">epistemic classification</span>
              <span className={`border px-1.5 py-0.5 text-label font-medium ${epistemicMeta.badge}`}>
                {finding.epistemic_level || 'inferred'}
              </span>
            </div>
            <p className="text-caption text-ink-soft">{epistemicMeta.desc}</p>

            <SupervisorRuleNotice evidence={finding.evidence} />

            {hasEvidence && (
              <div className="border-t border-line pt-2">
                <span className="block text-label font-medium text-ink-soft">observed telemetry</span>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {evidenceEntries.map(([key, val]) => (
                    <li key={key} className="flex items-center justify-between border-b border-dotted border-line py-0.5">
                      <span className="text-caption text-ink-soft">{formatEvidenceKey(key)}:</span>
                      <span className="font-mono text-caption font-medium tabular-nums text-ink">
                        {formatEvidenceValue(key, val)}
                      </span>
                    </li>
                  ))}
                  {plan?.basis && (
                    <li className="mt-1 text-caption text-ink-soft">
                      <span className="font-medium text-ink">operational basis: </span>
                      {plan.basis}
                    </li>
                  )}
                </ul>
              </div>
            )}

            {finding.limitations?.length > 0 && (
              <div className="border-t border-line pt-2">
                <span className="block text-label font-medium text-ink-soft">sensor & physics limitations</span>
                <p className="mt-0.5 text-caption text-ink-soft">{finding.limitations.join('; ')}</p>
              </div>
            )}

            {finding.entities?.length > 0 && (
              <div className="border-t border-line pt-1.5">
                <span className="text-caption text-ink-faint">
                  tracked entity identifiers: <span className="font-mono text-ink-soft">{finding.entities.join(', ')}</span>
                </span>
              </div>
            )}

            <div className="border-t border-line pt-2">
              <span className="block text-label font-medium text-ink-soft">raw audit event JSON</span>
              <pre className="mt-1 max-h-36 overflow-auto bg-ink p-2.5 font-mono text-caption leading-tight text-paper">
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

  if (error) return <p className="text-small text-danger">{error}</p>
  if (loading) {
    return (
      <div className="flex flex-col gap-1 border border-line bg-surface p-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse motion-reduce:animate-none bg-signal" />
          <span className="text-caption font-medium text-ink">
            evaluating risk lenses for frame {currentTime.toFixed(1)}s…
          </span>
        </div>
        <p className="text-caption text-ink-faint">running 2D spatial graph and kinematic analysis.</p>
      </div>
    )
  }

  if (!findings || findings.length === 0) {
    return (
      <div className="flex flex-col gap-1 border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="text-label text-ink-faint">
            analysis at <span className="font-mono tabular-nums">{formatTimestamp(currentTime)}</span>
          </span>
          <span className="text-label font-medium text-ok">normal operation</span>
        </div>
        <p className="mt-1 text-caption text-ink-soft">
          No actionable risk or conformance findings detected in this frame.
        </p>
      </div>
    )
  }

  const sortedFindings = [...findings].sort((a, b) => getFindingPriorityScore(b) - getFindingPriorityScore(a))
  const primaryFinding = sortedFindings[0]
  const secondaryFindings = sortedFindings.slice(1)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between border border-line bg-paper px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 bg-ok" />
          <span className="text-caption font-medium text-ink">
            analysis at <span className="font-mono tabular-nums">{formatTimestamp(currentTime)}</span>
          </span>
        </div>
        <span className="text-caption text-ink-faint">
          <span className="font-mono font-medium tabular-nums text-ink-soft">{findings.length}</span> finding{findings.length === 1 ? '' : 's'} evaluated
        </span>
      </div>

      <FindingCard finding={primaryFinding} isPrimary={true} onSimulateWhatIf={onSimulateWhatIf} />

      {secondaryFindings.length > 0 && (
        <div className="flex flex-col gap-2 border border-line bg-surface p-3">
          <div className="flex items-center justify-between">
            <span className="text-label font-medium text-ink-soft">
              other observations at this frame ({secondaryFindings.length})
            </span>
            <button
              onClick={() => setShowOtherObservations(!showOtherObservations)}
              className="text-caption font-medium text-ink-soft hover:text-ink hover:underline"
            >
              {showOtherObservations ? 'collapse' : `view ${secondaryFindings.length} more`}
            </button>
          </div>

          {showOtherObservations && (
            <div className="mt-2 flex flex-col gap-3 border-t border-line pt-3">
              {secondaryFindings.map((finding, index) => (
                <FindingCard key={index} finding={finding} isPrimary={false} onSimulateWhatIf={onSimulateWhatIf} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
