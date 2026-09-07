import { useState } from 'react'
import {
  getScenarioConfig,
  getPhysicalStackComparison,
  getSimplifiedInterventions,
} from '../../lib/scenarios.js'

const CLASSIFICATION_LABELS = {
  high_geometric_support: 'HIGH GEOMETRIC SUPPORT',
  moderate_geometric_support: 'MODERATE GEOMETRIC SUPPORT',
  weak_geometric_support: 'WEAK GEOMETRIC SUPPORT',
  poor_geometric_support: 'POOR GEOMETRIC SUPPORT',
}

const CLASSIFICATION_STYLES = {
  high_geometric_support: 'text-emerald-800 bg-emerald-50 border-emerald-300',
  moderate_geometric_support: 'text-blue-800 bg-blue-50 border-blue-300',
  weak_geometric_support: 'text-amber-800 bg-amber-50 border-amber-300',
  poor_geometric_support: 'text-red-800 bg-red-50 border-red-300',
}

function BreakdownBar({ label, value, max = 100, isPenalty = false }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const color = isPenalty
    ? value > 30
      ? 'bg-red-500'
      : 'bg-neutral-300'
    : value >= 75
      ? 'bg-emerald-600'
      : value >= 50
        ? 'bg-amber-500'
        : 'bg-red-500'

  return (
    <div className="flex flex-col gap-0.5 text-[11px]">
      <div className="flex justify-between text-neutral-600">
        <span>{label}</span>
        <span className="font-mono font-medium">
          {isPenalty ? `-${value.toFixed(0)}%` : `${value.toFixed(0)}%`}
        </span>
      </div>
      <div className="h-1.5 w-full bg-neutral-100 overflow-hidden border border-neutral-200">
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
}) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false)

  if (loading) {
    return (
      <div className="border border-line bg-white p-5 text-xs text-neutral-500 shadow-sm flex items-center gap-3">
        <span className="w-4 h-4 border-2 border-neutral-800 border-t-transparent animate-spin" />
        <div>
          <p className="font-bold text-neutral-900">Running What-If Simulation Engine…</p>
          <p className="text-neutral-500 text-[11px]">Testing safer placement alternatives against physical scene geometry.</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-red-300 bg-red-50 p-4 text-xs text-red-800 shadow-sm">
        <p className="font-bold">Simulation Error</p>
        <p className="mt-1">{error}</p>
        {onClose && (
          <button
            onClick={onClose}
            className="mt-2 text-[11px] underline text-red-700 hover:text-red-900 cursor-pointer"
          >
            Close
          </button>
        )}
      </div>
    )
  }

  if (!simulation) return null

  const config = getScenarioConfig(simulation.finding_scenario)

  if (!simulation.simulation_available) {
    return (
      <div className="border border-line bg-neutral-50 p-4 text-xs shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-neutral-800 uppercase tracking-wide text-[11px]">
            What-If Placement Simulation Unavailable
          </span>
          {onClose && (
            <button onClick={onClose} className="text-neutral-400 hover:text-ink text-sm font-bold cursor-pointer">
              ✕
            </button>
          )}
        </div>
        <p className="text-neutral-700 leading-relaxed">{simulation.simulation_notice}</p>
        {simulation.limitations?.length > 0 && (
          <p className="mt-2 text-[11px] text-neutral-500">
            <strong>Operational Basis:</strong> {simulation.limitations.join('; ')}
          </p>
        )}
      </div>
    )
  }

  const current = simulation.current
  const alternatives = simulation.alternatives || []
  const selectedCandidate =
    alternatives.find((c) => c.id === selectedCandidateId) || alternatives[0] || null

  const interventions = getSimplifiedInterventions(
    simulation.finding_scenario,
    current,
    alternatives
  )

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
    <div className="border border-line bg-white text-xs shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line bg-neutral-50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-bold tracking-wider text-ink text-[11px] uppercase bg-neutral-900 text-white px-1.5 py-0.5">
            Decision-Support Simulation
          </span>
          <span className="font-bold text-[12px] text-neutral-900">
            {config.title}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-ink px-1.5 py-0.5 text-sm font-bold cursor-pointer"
            title="Close What-If View"
          >
            ✕
          </button>
        )}
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* 1. CURRENT STATE: HIGH RISK */}
        <div className="border border-red-300 bg-red-50/40 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-red-200 pb-2">
            <span className="font-bold text-xs uppercase tracking-wider text-red-900 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" />
              <span>CURRENT STATE: HIGH RISK</span>
            </span>
            <span className="text-sm font-mono font-bold text-red-700">
              {current?.stability_score ? current.stability_score.toFixed(0) : 40} / 100 Stability
            </span>
          </div>

          <p className="text-xs text-red-950 leading-relaxed font-sans font-medium">
            <strong>Instability Mechanism:</strong> {problemDescription}
          </p>

          {/* Physical Stacking Dynamics Card */}
          {(() => {
            const stackInfo = getPhysicalStackComparison(
              simulation.finding_scenario,
              current,
              selectedCandidate
            )
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                {/* Current Observed Stack */}
                <div className="border border-red-300 bg-white p-2.5 flex flex-col items-center gap-1.5 text-center shadow-xs">
                  <span className={`text-[9px] font-bold px-2 py-0.5 uppercase ${stackInfo.current.riskBadgeStyle}`}>
                    {stackInfo.current.riskBadge}
                  </span>
                  <div className={`w-full py-1.5 px-2 border text-[11px] font-bold ${stackInfo.current.top.color}`}>
                    {stackInfo.current.top.label}
                  </div>
                  <span className="text-[10px] font-bold text-red-700 font-mono">
                    {stackInfo.current.arrow}
                  </span>
                  <div className={`w-full py-1 px-2 border text-[10px] ${stackInfo.current.bottom.color}`}>
                    {stackInfo.current.bottom.label}
                  </div>
                </div>

                {/* Proposed Corrected Stack */}
                <div className="border border-emerald-400 bg-white p-2.5 flex flex-col items-center gap-1.5 text-center shadow-xs">
                  <span className={`text-[9px] font-bold px-2 py-0.5 uppercase ${stackInfo.proposed.riskBadgeStyle}`}>
                    {stackInfo.proposed.riskBadge}
                  </span>
                  <div className={`w-full py-1.5 px-2 border text-[11px] font-bold ${stackInfo.proposed.top.color}`}>
                    {stackInfo.proposed.top.label}
                  </div>
                  <span className="text-[10px] font-bold text-emerald-800 font-mono">
                    {stackInfo.proposed.arrow}
                  </span>
                  <div className={`w-full py-1 px-2 border text-[10px] ${stackInfo.proposed.bottom.color}`}>
                    {stackInfo.proposed.bottom.label}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        {/* 2. WHAT IF WE INTERVENE? (2-3 CLEAR DECISION CHOICES) */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs uppercase tracking-wider text-neutral-900 flex items-center gap-1.5">
              <span>⚡ WHAT IF WE INTERVENE?</span>
            </span>
            <span className="text-[10px] text-neutral-500">
              Evaluated against optical scene geometry & manifest rules
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
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
                  className={`border p-3.5 transition-all flex flex-col gap-2 ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-500 shadow-sm'
                      : isDoNothing
                        ? 'border-neutral-200 bg-neutral-50/50 hover:border-red-300'
                        : 'border-neutral-200 bg-white hover:border-neutral-400'
                  } ${!isDoNothing ? 'cursor-pointer' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 uppercase ${option.badgeStyle}`}>
                        {option.badge}
                      </span>
                      <strong className="text-xs font-bold text-neutral-950">
                        {option.title}
                      </strong>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase ${option.predictedRiskStyle}`}>
                        {option.predictedRisk}
                      </span>
                      <span className="font-mono font-bold text-xs tabular-nums text-neutral-900">
                        {option.score} / 100
                      </span>
                      {option.scoreDelta > 0 && (
                        <span className="text-[10px] font-mono font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 border border-emerald-300">
                          +{option.scoreDelta} Gain
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] text-neutral-700 leading-relaxed font-sans">
                    {option.whySafer}
                  </p>

                  <div className="pt-2 border-t border-neutral-200/60 flex items-center justify-between">
                    <span className="text-[10px] text-neutral-500">
                      {isDoNothing ? 'Status quo baseline' : 'Physically feasible placement'}
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
                        className={`px-2.5 py-1 text-[11px] font-bold border transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-emerald-700 bg-emerald-800 text-white'
                            : 'border-neutral-800 bg-neutral-900 text-white hover:bg-neutral-800'
                        }`}
                      >
                        {isSelected ? '✓ Simulation Active' : option.cta}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 3. PROGRESSIVE DISCLOSURE: MATHEMATICAL BREAKDOWN & TRAJECTORY DETAILS */}
        <div className="border border-neutral-200 bg-neutral-50/60 p-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="flex items-center justify-between text-xs text-neutral-700 hover:text-neutral-950 font-bold uppercase tracking-wider cursor-pointer"
          >
            <span>▸ Mathematical Breakdown & Trajectory Details</span>
            <span className="font-mono text-[11px]">{showTechnicalDetails ? '▲ Hide' : '▼ Expand'}</span>
          </button>

          {showTechnicalDetails && (
            <div className="mt-2 pt-2 border-t border-neutral-200 flex flex-col gap-3 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Current Breakdown */}
                <div className="border border-neutral-200 bg-white p-3 flex flex-col gap-2">
                  <span className="font-bold text-[10px] uppercase text-neutral-700">
                    Current Placement Breakdown
                  </span>
                  <BreakdownBar
                    label="Support Alignment"
                    value={current?.breakdown?.support_alignment || 0}
                  />
                  <BreakdownBar label="Centering" value={current?.breakdown?.centering || 0} />
                  <BreakdownBar label="Mass Order" value={current?.breakdown?.mass_order || 0} />
                  <BreakdownBar
                    label="Overhang Penalty"
                    value={current?.breakdown?.overhang_penalty || 0}
                    isPenalty={true}
                  />
                </div>

                {/* Simulated Alternative Breakdown */}
                {selectedCandidate && (
                  <div className="border border-neutral-200 bg-white p-3 flex flex-col gap-2">
                    <span className="font-bold text-[10px] uppercase text-neutral-700">
                      Simulated Placement Breakdown
                    </span>
                    <BreakdownBar
                      label="Support Alignment"
                      value={selectedCandidate.score_breakdown?.support_alignment || 0}
                    />
                    <BreakdownBar
                      label="Centering"
                      value={selectedCandidate.score_breakdown?.centering || 0}
                    />
                    <BreakdownBar
                      label="Mass Order"
                      value={selectedCandidate.score_breakdown?.mass_order || 0}
                    />
                    <BreakdownBar
                      label="Overhang Penalty"
                      value={selectedCandidate.score_breakdown?.overhang_penalty || 0}
                      isPenalty={true}
                    />
                  </div>
                )}
              </div>

              {selectedCandidate && (
                <div className="text-[11px] text-neutral-600 bg-white p-2.5 border border-neutral-200 flex flex-col gap-1 font-mono">
                  <span>Simulated 2D Normalized Coordinates: [{selectedCandidate.position[0]}, {selectedCandidate.position[1]}]</span>
                  <span>Support Relationship Edge: {selectedCandidate.support_relationship || 'direct_support'}</span>
                  <span>Feasibility Check: {selectedCandidate.feasibility ? 'PASSED (Clearance verified)' : 'CAUTION (Tight clearance)'}</span>
                </div>
              )}

              {simulation.limitations?.length > 0 && (
                <div className="text-[10px] text-neutral-500 pt-1 border-t border-neutral-200">
                  <strong className="uppercase">Operational Boundaries: </strong>
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
