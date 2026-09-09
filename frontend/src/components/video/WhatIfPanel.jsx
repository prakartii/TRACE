import { useState } from 'react'
import { X } from 'lucide-react'
import {
  getScenarioConfig,
  getPhysicalStackComparison,
  getSimplifiedInterventions,
} from '../../lib/scenarios.js'

const CLASSIFICATION_LABELS = {
  high_geometric_support: 'high geometric support',
  moderate_geometric_support: 'moderate geometric support',
  weak_geometric_support: 'weak geometric support',
  poor_geometric_support: 'poor geometric support',
}

const CLASSIFICATION_STYLES = {
  high_geometric_support: 'text-ok bg-ok/10 border-ok/40',
  moderate_geometric_support: 'text-steel bg-steel/10 border-steel/40',
  weak_geometric_support: 'text-[#8a5f00] bg-signal/10 border-signal/40',
  poor_geometric_support: 'text-danger bg-danger/10 border-danger/40',
}

function BreakdownBar({ label, value, max = 100, isPenalty = false, indicator = false }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const color = indicator
    ? 'bg-line-strong'
    : isPenalty
      ? value > 30
        ? 'bg-danger'
        : 'bg-line'
      : value >= 75
        ? 'bg-ok'
        : value >= 50
          ? 'bg-signal'
          : 'bg-danger'

  return (
    <div className="flex flex-col gap-0.5 text-caption">
      <div className="flex justify-between text-ink-soft">
        <span>
          {label}
          {indicator && <span className="ml-1 text-ink-faint">(reported, not scored)</span>}
        </span>
        <span className="font-mono">
          {isPenalty ? `-${value.toFixed(0)}%` : `${value.toFixed(0)}%`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden border border-line bg-paper">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function WhatIfPanel({
  simulation,
  loading,
  error,
  selectedCandidateId,
  onSelectCandidate,
  onClose,
  onOpenReplay,
}) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center gap-3 border border-line bg-surface p-5">
        <span className="h-4 w-4 animate-spin motion-reduce:animate-none border-2 border-ink border-t-transparent" />
        <div>
          <p className="text-small font-medium text-ink">running what-if simulation engine…</p>
          <p className="text-caption text-ink-soft">testing safer placements against scene geometry.</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-danger bg-danger/5 p-4 text-small text-danger">
        <p className="font-medium">simulation error</p>
        <p className="mt-1">{error}</p>
        {onClose && (
          <button onClick={onClose} className="mt-2 text-caption underline hover:text-ink">
            close
          </button>
        )}
      </div>
    )
  }

  if (!simulation) return null

  const config = getScenarioConfig(simulation.finding_scenario)

  if (!simulation.simulation_available) {
    return (
      <div className="border border-line bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-small font-medium text-ink">what-if simulation unavailable</span>
          {onClose && (
            <button onClick={onClose} className="text-ink-faint hover:text-ink">
              <X size={15} />
            </button>
          )}
        </div>
        <p className="text-small text-ink-soft">{simulation.simulation_notice}</p>
        {simulation.limitations?.length > 0 && (
          <p className="mt-2 text-caption text-ink-faint">
            <span className="font-medium text-ink">operational basis:</span> {simulation.limitations.join('; ')}
          </p>
        )}
        {onOpenReplay && (
          <button
            type="button"
            onClick={onOpenReplay}
            className="mt-3 inline-flex items-center gap-1.5 border border-ink bg-ink px-3 py-1.5 text-caption font-semibold text-paper transition-colors hover:bg-ink-soft"
          >
            open the full What-If Replay for a recorded incident →
          </button>
        )}
      </div>
    )
  }

  const current = simulation.current
  const alternatives = simulation.alternatives || []
  const selectedCandidate =
    alternatives.find((c) => c.id === selectedCandidateId) || alternatives[0] || null

  const interventions = getSimplifiedInterventions(simulation.finding_scenario, current, alternatives)

  const problemDescription = (() => {
    const bd = current?.breakdown || {}
    const issues = []
    if (bd.overhang_penalty > 0) {
      issues.push(`Cantilever overhang: package extends beyond supporting foundation deck (-${bd.overhang_penalty.toFixed(0)}% stability penalty).`)
    }
    if (bd.support_alignment < 70) {
      issues.push(`Insufficient base coverage: horizontal deck overlap is only ${bd.support_alignment.toFixed(0)}%.`)
    }
    if (bd.mass_order < 70) {
      issues.push(`Adverse mass tiering: heavier cargo positioned on top of lighter foundation tier.`)
    }
    if (bd.centering < 60) {
      issues.push(`Eccentric loading: item center of mass is severely offset from support centerline.`)
    }
    if (issues.length === 0) {
      return config.whyItMatters || `Geometric placement stability violates warehouse safety criteria.`
    }
    return issues.join(' ')
  })()

  return (
    <div className="border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line bg-paper px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="bg-ink px-1.5 py-0.5 text-label font-medium text-paper">
            decision-support simulation
          </span>
          <span className="text-small font-medium text-ink">{config.title}</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-ink-faint hover:text-ink">
            <X size={15} />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3 border border-danger/40 bg-danger/5 p-4">
          <div className="flex items-center justify-between border-b border-danger/20 pb-2">
            <span className="text-small font-medium text-danger">current state: high risk</span>
            <span className="font-mono text-small font-semibold text-danger">
              {current?.stability_score ? current.stability_score.toFixed(0) : 40} / 100 stability
            </span>
          </div>

          <p className="text-small text-ink">
            <span className="font-medium">instability mechanism:</span> {problemDescription}
          </p>

          {(() => {
            const stackInfo = getPhysicalStackComparison(simulation.finding_scenario, current, selectedCandidate)
            return (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col items-center gap-1.5 border border-danger/40 bg-surface p-2.5 text-center">
                  <span className={`px-2 py-0.5 text-label font-medium ${stackInfo.current.riskBadgeStyle}`}>
                    {stackInfo.current.riskBadge}
                  </span>
                  <div className={`w-full border px-2 py-1.5 text-caption font-medium ${stackInfo.current.top.color}`}>
                    {stackInfo.current.top.label}
                  </div>
                  <span className="font-mono text-caption text-danger">{stackInfo.current.arrow}</span>
                  <div className={`w-full border px-2 py-1 text-caption ${stackInfo.current.bottom.color}`}>
                    {stackInfo.current.bottom.label}
                  </div>
                </div>

                <div className="flex flex-col items-center gap-1.5 border border-ok/40 bg-surface p-2.5 text-center">
                  <span className={`px-2 py-0.5 text-label font-medium ${stackInfo.proposed.riskBadgeStyle}`}>
                    {stackInfo.proposed.riskBadge}
                  </span>
                  <div className={`w-full border px-2 py-1.5 text-caption font-medium ${stackInfo.proposed.top.color}`}>
                    {stackInfo.proposed.top.label}
                  </div>
                  <span className="font-mono text-caption text-ok">{stackInfo.proposed.arrow}</span>
                  <div className={`w-full border px-2 py-1 text-caption ${stackInfo.proposed.bottom.color}`}>
                    {stackInfo.proposed.bottom.label}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-small font-medium text-ink">what if we intervene?</span>
            <span className="text-caption text-ink-faint">evaluated against scene geometry & manifest rules</span>
          </div>

          <div className="flex flex-col gap-2.5">
            {interventions.map((option) => {
              const isSelected = selectedCandidate?.id === option.id || (option.id === 'opt-a' && !selectedCandidateId)
              const isDoNothing = option.id === 'opt-c-do-nothing'

              return (
                <div
                  key={option.id}
                  onClick={() => {
                    if (option.candidate && onSelectCandidate) {
                      onSelectCandidate(option.candidate.id)
                    }
                  }}
                  className={`flex flex-col gap-2 border p-3.5 ${
                    isSelected
                      ? 'border-ok/40 bg-ok/5'
                      : isDoNothing
                        ? 'border-line bg-paper hover:border-danger/40'
                        : 'border-line bg-surface hover:border-line-strong'
                  } ${!isDoNothing ? 'cursor-pointer' : ''}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 text-label font-medium ${option.badgeStyle}`}>
                        {option.badge}
                      </span>
                      <span className="text-small font-semibold text-ink">{option.title}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`border px-2 py-0.5 text-label font-medium ${option.predictedRiskStyle}`}>
                        {option.predictedRisk}
                      </span>
                      <span className="font-mono text-caption font-semibold tabular-nums text-ink">
                        {option.score} / 100
                      </span>
                      {option.scoreDelta > 0 && (
                        <span className="border border-ok/40 bg-ok/10 px-1.5 py-0.5 font-mono text-label font-medium text-ok">
                          +{option.scoreDelta} gain
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-caption text-ink-soft">{option.whySafer}</p>

                  <div className="flex items-center justify-between border-t border-line pt-2">
                    <span className="text-caption text-ink-faint">
                      {isDoNothing ? 'status quo baseline' : 'physically feasible placement'}
                    </span>
                    {!isDoNothing && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (option.candidate && onSelectCandidate) {
                            onSelectCandidate(option.candidate.id)
                          }
                        }}
                        className={`border px-2.5 py-1 text-caption font-medium transition-colors ${
                          isSelected
                            ? 'border-ok bg-ok text-paper'
                            : 'border-ink bg-ink text-paper hover:bg-ink-soft'
                        }`}
                      >
                        {isSelected ? 'simulation active' : option.cta}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 border border-line bg-paper p-3">
          <button
            type="button"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="flex items-center justify-between text-caption font-medium text-ink-soft hover:text-ink"
          >
            <span>mathematical breakdown & trajectory details</span>
            <span className="font-mono">{showTechnicalDetails ? '−' : '+'}</span>
          </button>

          {showTechnicalDetails && (
            <div className="mt-2 flex flex-col gap-3 border-t border-line pt-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-2 border border-line bg-surface p-3">
                  <span className="text-label font-medium text-ink-soft">current placement breakdown</span>
                  <BreakdownBar label="support alignment" value={current?.breakdown?.support_alignment || 0} />
                  <BreakdownBar label="centering" value={current?.breakdown?.centering || 0} />
                  <BreakdownBar label="mass order" value={current?.breakdown?.mass_order || 0} />
                  <BreakdownBar label="overhang penalty" value={current?.breakdown?.overhang_penalty || 0} isPenalty={true} />
                  <BreakdownBar label="tipping estimate" value={current?.breakdown?.tipping_estimate || 0} indicator={true} />
                </div>

                {selectedCandidate && (
                  <div className="flex flex-col gap-2 border border-line bg-surface p-3">
                    <span className="text-label font-medium text-ink-soft">simulated placement breakdown</span>
                    <BreakdownBar label="support alignment" value={selectedCandidate.score_breakdown?.support_alignment || 0} />
                    <BreakdownBar label="centering" value={selectedCandidate.score_breakdown?.centering || 0} />
                    <BreakdownBar label="mass order" value={selectedCandidate.score_breakdown?.mass_order || 0} />
                    <BreakdownBar label="overhang penalty" value={selectedCandidate.score_breakdown?.overhang_penalty || 0} isPenalty={true} />
                    <BreakdownBar label="tipping estimate" value={selectedCandidate.score_breakdown?.tipping_estimate || 0} indicator={true} />
                  </div>
                )}
              </div>

              {selectedCandidate && (
                <div className="flex flex-col gap-1 border border-line bg-surface p-2.5 font-mono text-caption text-ink-soft">
                  <span>simulated 2D normalized coordinates: [{selectedCandidate.position[0]}, {selectedCandidate.position[1]}]</span>
                  <span>support relationship edge: {selectedCandidate.support_relationship || 'direct_support'}</span>
                  <span>feasibility check: {selectedCandidate.feasibility ? 'passed (clearance verified)' : 'caution (tight clearance)'}</span>
                </div>
              )}

              {simulation.limitations?.length > 0 && (
                <div className="border-t border-line pt-1 text-caption text-ink-faint">
                  <span className="font-medium text-ink-soft">operational boundaries: </span>
                  {simulation.limitations.join('; ')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
