import { useState } from 'react'

const CLASSIFICATION_LABELS = {
  high_geometric_support: 'HIGH GEOMETRIC SUPPORT',
  moderate_geometric_support: 'MODERATE GEOMETRIC SUPPORT',
  weak_geometric_support: 'WEAK GEOMETRIC SUPPORT',
  poor_geometric_support: 'POOR GEOMETRIC SUPPORT',
}

const CLASSIFICATION_STYLES = {
  high_geometric_support: 'text-emerald-700 bg-emerald-50 border-emerald-300',
  moderate_geometric_support: 'text-blue-700 bg-blue-50 border-blue-300',
  weak_geometric_support: 'text-amber-700 bg-amber-50 border-amber-300',
  poor_geometric_support: 'text-red-700 bg-red-50 border-red-300',
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
  const [showExplanation, setShowExplanation] = useState(false)

  if (loading) {
    return (
      <div className="border border-line bg-white p-4 text-xs text-neutral-500">
        <p className="font-medium text-ink">Running What-If Simulation Engine…</p>
        <p className="mt-1 text-neutral-400">Evaluating candidate placements against scene geometry.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-red-200 bg-red-50 p-4 text-xs text-red-700">
        <p className="font-medium">Simulation Error</p>
        <p className="mt-1">{error}</p>
        {onClose && (
          <button
            onClick={onClose}
            className="mt-2 text-[11px] underline text-red-600 hover:text-red-800"
          >
            Close
          </button>
        )}
      </div>
    )
  }

  if (!simulation) return null

  if (!simulation.simulation_available) {
    return (
      <div className="border border-line bg-neutral-50 p-4 text-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-neutral-700 uppercase tracking-wide text-[11px]">
            What-If Simulation Unavailable
          </span>
          {onClose && (
            <button onClick={onClose} className="text-neutral-400 hover:text-ink text-sm">
              ✕
            </button>
          )}
        </div>
        <p className="text-neutral-600">{simulation.simulation_notice}</p>
        {simulation.limitations?.length > 0 && (
          <p className="mt-2 text-[11px] text-neutral-400">
            Basis: {simulation.limitations.join(', ')}
          </p>
        )}
      </div>
    )
  }

  const current = simulation.current
  const alternatives = simulation.alternatives || []
  const selectedCandidate =
    alternatives.find((c) => c.id === selectedCandidateId) || alternatives[0] || null

  const problemDescription = (() => {
    const bd = current?.breakdown || {}
    const issues = []
    if (bd.overhang_penalty > 0) {
      issues.push(`Cantilever overhang: package extends beyond supporting foundation deck (-${bd.overhang_penalty.toFixed(0)}% penalty).`)
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
      return `Geometric placement stability violates warehouse safety criteria for ${simulation.finding_scenario.replace(/_/g, ' ')}.`
    }
    return issues.join(' ')
  })()

  return (
    <div className="border border-line bg-white text-xs shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line bg-neutral-50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-bold tracking-wider text-ink text-[11px] uppercase bg-neutral-200 px-1.5 py-0.5 border border-neutral-300">
            What-If Placement Analysis
          </span>
          <span className="font-semibold text-[12px] text-ink capitalize">
            {simulation.finding_scenario.replace(/_/g, ' ')}
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

      {/* Mandatory Epistemic Disclaimer */}
      <div className="border-b border-amber-200 bg-amber-50/80 px-4 py-2 text-[11px] text-amber-900 leading-tight">
        <span className="font-bold">EPISTEMIC NOTICE: </span>
        {simulation.simulation_notice} Physical load capacity, internal box deformation, and friction dynamics are not measured.
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Step 2: PROBLEM IDENTIFIED BANNER */}
        <div className="border border-amber-300 bg-amber-50/60 p-3 flex flex-col gap-1">
          <span className="font-bold text-[10px] uppercase tracking-wider text-amber-900">
            2. Problem Identified in Current Placement
          </span>
          <p className="text-[11px] font-medium text-amber-950 leading-relaxed">
            {problemDescription}
          </p>
        </div>

        {/* Step 1 & 4: CURRENT vs RESULT COMPARISON */}
        <div className="grid grid-cols-2 gap-4">
          {/* Step 1: Observed Placement */}
          <div className="border border-line p-3 bg-neutral-50/70 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  1. Current Observed
                </span>
                <span
                  className={`border px-1.5 py-0.5 text-[9px] font-bold ${
                    CLASSIFICATION_STYLES[current.classification] || 'text-neutral-600 bg-neutral-100 border-neutral-300'
                  }`}
                >
                  {CLASSIFICATION_LABELS[current.classification] || current.classification}
                </span>
              </div>
              <div className="flex items-baseline gap-1 my-1">
                <span className="text-2xl font-mono font-bold text-ink">
                  {current.stability_score.toFixed(0)}
                </span>
                <span className="text-neutral-400 text-[11px]">/ 100 Stability</span>
              </div>
            </div>
            <div className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2">
              <BreakdownBar
                label="Support Alignment"
                value={current.breakdown?.support_alignment || 0}
              />
              <BreakdownBar label="Centering" value={current.breakdown?.centering || 0} />
              <BreakdownBar label="Mass Order" value={current.breakdown?.mass_order || 0} />
              <BreakdownBar
                label="Overhang Penalty"
                value={current.breakdown?.overhang_penalty || 0}
                isPenalty={true}
              />
            </div>
          </div>

          {/* Step 4: Hypothetical Result */}
          {selectedCandidate && (
            <div className="border-2 border-emerald-500 p-3 bg-emerald-50/30 flex flex-col justify-between relative shadow-sm">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                    4. Hypothetical Result
                  </span>
                  <span className="border border-emerald-400 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-900 font-mono">
                    +{selectedCandidate.score_delta > 0 ? selectedCandidate.score_delta : 0} Stability Gain
                  </span>
                </div>
                <div className="flex items-baseline gap-1 my-1">
                  <span className="text-2xl font-mono font-bold text-emerald-700">
                    {selectedCandidate.score.toFixed(0)}
                  </span>
                  <span className="text-emerald-700 text-[11px] font-medium">/ 100 Stability</span>
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-1.5 border-t border-emerald-200 pt-2">
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
            </div>
          )}
        </div>

        {/* Step 3: SAFER ALTERNATIVE SELECTION */}
        <div>
          <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            3. Select Safer Alternative Placement ({alternatives.length} Generated)
          </span>
          <div className="flex flex-col gap-2">
            {alternatives.map((cand, idx) => {
              const isSelected = selectedCandidate?.id === cand.id
              return (
                <div
                  key={cand.id || idx}
                  onClick={() => onSelectCandidate && onSelectCandidate(cand.id)}
                  className={`cursor-pointer border p-2.5 transition-all ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50/50 shadow-sm ring-1 ring-emerald-500'
                      : 'border-line bg-white hover:border-neutral-400'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[11px] text-ink uppercase bg-neutral-100 px-1 py-0.5 border border-neutral-300">
                          Option {String.fromCharCode(65 + idx)}
                        </span>
                        <span className="font-medium text-ink">{cand.description}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[10px] text-neutral-500">
                        <span>
                          Relationship: <span className="font-mono text-neutral-800">{cand.support_relationship}</span>
                        </span>
                        {cand.feasibility ? (
                          <span className="text-emerald-700 font-bold">✓ Geometrically Feasible</span>
                        ) : (
                          <span className="text-amber-700 font-bold">⚠ Clearance Caution</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <span className="font-mono font-bold text-sm text-ink">
                        {cand.score.toFixed(0)}
                      </span>
                      <span className="text-[10px] font-mono text-emerald-700 font-bold">
                        +{cand.score_delta > 0 ? cand.score_delta : 0} Gain
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Step 5: WHY THIS CANDIDATE IS SAFER */}
        <div className="border border-line bg-neutral-50 p-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-neutral-800 text-[10px] uppercase tracking-wider">
              5. Why Is This Candidate Safer? (Audit Verification)
            </span>
            <button
              onClick={() => setShowExplanation(!showExplanation)}
              className="text-[11px] font-medium text-blue-700 hover:underline cursor-pointer"
            >
              {showExplanation ? 'Hide rationale' : 'View full comparative breakdown'}
            </button>
          </div>

          {showExplanation && selectedCandidate && (
            <div className="mt-2.5 flex flex-col gap-1.5 text-[11px] text-neutral-700 border-t border-neutral-200 pt-2">
              <p>
                • <strong>Support alignment:</strong> Horizontal deck overlap improved from{' '}
                {(current.breakdown?.support_alignment || 0).toFixed(0)}% to{' '}
                {(selectedCandidate.score_breakdown?.support_alignment || 0).toFixed(0)}%.
              </p>
              <p>
                • <strong>Cantilever overhang:</strong> Edge protrusion penalty reduced from{' '}
                {(current.breakdown?.overhang_penalty || 0).toFixed(0)}% to{' '}
                {(selectedCandidate.score_breakdown?.overhang_penalty || 0).toFixed(0)}%.
              </p>
              <p>
                • <strong>Stacking tiering:</strong> Mass distribution factor evaluated at{' '}
                {(selectedCandidate.score_breakdown?.mass_order || 0).toFixed(0)} points based on SKU manifest.
              </p>
              <p className="mt-1 text-neutral-500 font-mono text-[10px]">
                Simulated 2D Normalized Coordinates: [{selectedCandidate.position[0]}, {selectedCandidate.position[1]}].
              </p>
            </div>
          )}
        </div>

        {/* Step 6: EPISTEMIC LIMITATIONS */}
        {simulation.limitations?.length > 0 && (
          <div className="border-t border-neutral-100 pt-1">
            <p className="text-[10px] text-neutral-500 leading-snug">
              <span className="font-medium uppercase tracking-wider">6. Operational Boundaries: </span>
              {simulation.limitations.join('; ')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
