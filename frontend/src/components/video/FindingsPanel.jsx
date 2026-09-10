import { useState } from 'react'
import { ArrowRight, ChevronDown, CheckCircle2, AlertTriangle, ShieldCheck, Play, FlaskConical } from 'lucide-react'
import {
  getScenarioConfig,
  RISK_BAND_STYLES,
  STATUS_STYLES,
  EPISTEMIC_LEVELS,
  formatEvidenceKey,
  formatEvidenceValue,
  telemetryEntries,
} from '../../lib/scenarios.js'
import { humanizeExplanation, humanizeTitle, humanizeAction } from '../../lib/format.js'
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

function PrimaryFindingCard({
  finding,
  onSimulateWhatIf,
  onReviewHazard,
  onReplayIncident,
}) {
  const [showEvidence, setShowEvidence] = useState(false)
  const plan = finding.planner_recommendation
  const config = getScenarioConfig(finding.scenario)

  const isEligible =
    plan?.what_if_eligible ??
    (config.whatIfEligible &&
      ['supported', 'probable'].includes(finding.status) &&
      ['structural', 'conformance'].includes(finding.lens))

  const evidenceEntries = telemetryEntries(finding.evidence)
  const hasEvidence = evidenceEntries.length > 0 || plan?.basis

  const riskBand = finding.band || config.defaultBand || 'Medium'
  const bandStyle = RISK_BAND_STYLES[riskBand] || RISK_BAND_STYLES.Medium
  const statusMeta = STATUS_STYLES[finding.status] || STATUS_STYLES.insufficient_evidence
  const epistemicMeta = EPISTEMIC_LEVELS[finding.epistemic_level] || EPISTEMIC_LEVELS.INFERRED

  const displayTitle = humanizeTitle(
    config.title || plan?.risk_title || finding.scenario?.replace(/_/g, ' ') || 'Active Hazard',
    finding.scenario
  )
  const whatIsHappening = humanizeExplanation(
    finding.explanation || config.whatIsHappening,
    finding.scenario,
    finding.entity_id
  )
  const whyItMatters = humanizeExplanation(
    plan?.rationale || config.whyItMatters,
    finding.scenario,
    finding.entity_id
  )
  const safeAction = humanizeAction(
    plan?.action || finding.recommended_action || config.recommendedAction || 'Inspect cargo position',
    finding.scenario
  )

  return (
    <div className="border border-line bg-surface p-5 shadow-xs">
      {/* Top Status Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-ink px-2.5 py-0.5 text-label font-bold uppercase tracking-wider text-paper">
            Active Hazard
          </span>
          <span className={`border px-2.5 py-0.5 text-label font-bold uppercase ${bandStyle.subtle}`}>
            {bandStyle.label}
          </span>
        </div>
        <div className="text-caption text-ink-soft">
          Certainty: <strong className="text-ink">{finding.confidence || 'Medium'}</strong>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="mt-4 flex flex-col gap-3">
        <h3 className="text-lg font-bold text-ink leading-snug">
          {displayTitle}
        </h3>

        {/* Unified explanation: What + Why in clean, readable prose */}
        <p className="text-small text-ink leading-relaxed">
          <strong className="text-ink font-semibold">Condition:</strong> {whatIsHappening}{' '}
          <span className="text-ink-soft">{whyItMatters}</span>
        </p>

        {/* Immediate Safe Action Banner */}
        <div className="rounded-xs border border-ok/40 bg-ok/5 p-3.5 flex flex-col gap-1">
          <span className="text-label font-bold uppercase tracking-wider text-ok">
            Immediate Action Required
          </span>
          <p className="text-small font-bold text-ink">"{safeAction}"</p>
        </div>

        {/* Direct Workflow CTAs */}
        <div className="mt-2 flex flex-wrap items-center gap-2.5 pt-2 border-t border-line">
          {onReviewHazard && (
            <button
              type="button"
              onClick={onReviewHazard}
              className="inline-flex items-center gap-1.5 bg-ink px-3.5 py-2 text-caption font-semibold text-paper hover:bg-ink-soft cursor-pointer transition-colors"
            >
              <span>Review in Active Hazards (Step 2)</span>
              <ArrowRight size={13} />
            </button>
          )}

          {onReplayIncident && (
            <button
              type="button"
              onClick={onReplayIncident}
              className="inline-flex items-center gap-1.5 border border-line bg-paper px-3 py-2 text-caption font-medium text-ink hover:border-ink cursor-pointer transition-colors"
            >
              <Play size={12} />
              <span>Replay Incident Evidence (Step 3)</span>
            </button>
          )}

          {isEligible && onSimulateWhatIf && (
            <button
              type="button"
              onClick={() => onSimulateWhatIf(finding)}
              className="inline-flex items-center gap-1.5 border border-ok/40 bg-ok/10 px-3 py-2 text-caption font-semibold text-ok hover:bg-ok/20 cursor-pointer transition-colors"
            >
              <FlaskConical size={13} />
              <span>Simulate Safer Placement (Step 4)</span>
            </button>
          )}
        </div>
      </div>

      {/* Expandable Evidence */}
      <div className="mt-3 border-t border-line/60 pt-2">
        <button
          type="button"
          onClick={() => setShowEvidence(!showEvidence)}
          className="flex w-full items-center justify-between py-1 text-caption text-ink-soft hover:text-ink cursor-pointer"
        >
          <span>Why TRACE Flagged This</span>
          <span className="font-mono text-[11px] text-ink-faint">
            {showEvidence ? '▲ collapse' : '▼ expand'}
          </span>
        </button>

        {showEvidence && (
          <div className="mt-2 flex flex-col gap-2.5 border border-line bg-paper p-3 text-caption">
            <div className="text-small text-ink">
              <span className="font-semibold">Detection Verification:</span> TRACE tracked and verified this hazard condition across consecutive video frames.
            </div>

            <SupervisorRuleNotice evidence={finding.evidence} />

            {hasEvidence && (
              <div className="space-y-1">
                <span className="font-semibold text-ink">Observed Measurements:</span>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-ink-soft">
                  {evidenceEntries.map(([key, val]) => (
                    <div key={key} className="flex justify-between border-b border-dotted border-line py-0.5">
                      <span>{formatEvidenceKey(key)}:</span>
                      <strong className="text-ink">{formatEvidenceValue(key, val)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function FindingsPanel({
  findings,
  loading,
  error,
  currentTime = 0,
  onSimulateWhatIf,
  onReviewHazard,
  onReplayIncident,
}) {
  const [showSecondary, setShowSecondary] = useState(false)

  if (error) {
    return (
      <div className="border border-danger/30 bg-danger/5 p-4 text-small text-danger">
        {error}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 border border-line bg-surface p-4 text-caption text-ink-soft">
        <span className="h-3 w-3 animate-spin border-2 border-ink border-t-transparent" />
        <span>Evaluating safety lenses for playhead {currentTime.toFixed(1)}s…</span>
      </div>
    )
  }

  if (!findings || findings.length === 0) {
    return (
      <div className="flex items-center justify-between border border-line bg-surface px-4 py-3 text-small">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} className="text-ok" />
          <span className="font-semibold text-ink">Normal Operation · All Clear</span>
          <span className="text-caption text-ink-soft">
            — No safety hazards detected at {formatTimestamp(currentTime)}
          </span>
        </div>
        <span className="text-caption font-mono text-ink-faint">Continuous Monitoring</span>
      </div>
    )
  }

  const sortedFindings = [...findings].sort(
    (a, b) => getFindingPriorityScore(b) - getFindingPriorityScore(a),
  )
  const primaryFinding = sortedFindings[0]
  const secondaryFindings = sortedFindings.slice(1)

  return (
    <div className="flex flex-col gap-3">
      <PrimaryFindingCard
        finding={primaryFinding}
        onSimulateWhatIf={onSimulateWhatIf}
        onReviewHazard={onReviewHazard}
        onReplayIncident={onReplayIncident}
      />

      {secondaryFindings.length > 0 && (
        <div className="border border-line bg-surface p-3 text-caption">
          <div className="flex items-center justify-between">
            <span className="font-medium text-ink-soft">
              {secondaryFindings.length} secondary observation{secondaryFindings.length === 1 ? '' : 's'} at this frame
            </span>
            <button
              type="button"
              onClick={() => setShowSecondary(!showSecondary)}
              className="text-ink font-semibold hover:underline cursor-pointer"
            >
              {showSecondary ? 'Hide secondary observations' : `View ${secondaryFindings.length} more`}
            </button>
          </div>

          {showSecondary && (
            <div className="mt-3 flex flex-col gap-2.5 border-t border-line pt-3">
              {secondaryFindings.map((f, idx) => (
                <div key={idx} className="border border-line bg-paper p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink">
                      {humanizeExplanation(f.explanation || f.scenario?.replace(/_/g, ' '), f.scenario)}
                    </span>
                    <span className="border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">
                      {f.band || 'Medium'} Risk
                    </span>
                  </div>
                  {f.recommended_action && (
                    <p className="mt-1 text-ink-soft">Action: {humanizeAction(f.recommended_action, f.scenario)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
