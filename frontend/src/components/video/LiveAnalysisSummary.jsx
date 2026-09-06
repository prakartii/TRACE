import { getFindingPriorityScore } from './FindingsPanel.jsx'

const STATUS_BADGES = {
  supported: {
    bg: 'bg-emerald-50 border-emerald-300 text-emerald-800',
    dot: 'bg-emerald-600',
    title: 'Immediate Precaution Required',
  },
  probable: {
    bg: 'bg-amber-50 border-amber-300 text-amber-800',
    dot: 'bg-amber-500',
    title: 'Verification Required',
  },
  insufficient_evidence: {
    bg: 'bg-neutral-100 border-neutral-300 text-neutral-700',
    dot: 'bg-neutral-400',
    title: 'Observation Under Review (Insufficient Evidence)',
  },
  unsupported: {
    bg: 'bg-neutral-100 border-neutral-300 text-neutral-600',
    dot: 'bg-neutral-300',
    title: 'Undetermined Condition (Unsupported)',
  },
}

function formatTime(sec) {
  if (typeof sec !== 'number' || isNaN(sec)) return '00:00.0'
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1)
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`
}

export default function LiveAnalysisSummary({ video, findings, loading, findingsEnabled, currentTime }) {
  // 1. No video selected
  if (!video) {
    return (
      <div className="border border-line bg-white p-4 mb-4 text-xs">
        <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
          <div>
            <h3 className="font-bold text-sm text-ink tracking-tight">TRACE Live Analysis</h3>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Continuous monitoring for unsafe handling, structural instability, worker proximity, and process conformance.
            </p>
          </div>
          <span className="border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-600 uppercase">
            Standby
          </span>
        </div>
        <p className="text-neutral-500">
          Select a warehouse video source from the library on the right to begin live operational evaluation.
        </p>
      </div>
    )
  }

  // 2. Findings toggle disabled
  if (!findingsEnabled) {
    return (
      <div className="border border-line bg-white p-4 mb-4 text-xs">
        <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
          <div>
            <h3 className="font-bold text-sm text-ink tracking-tight">TRACE Live Analysis</h3>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Source: <strong className="text-ink">{video.filename}</strong>
            </p>
          </div>
          <span className="border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 uppercase">
            Findings Paused
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 text-neutral-600">
          <div>
            <span className="font-bold uppercase tracking-wider text-[10px] text-neutral-400 block mb-0.5">
              Current Status
            </span>
            <p className="text-ink font-medium">Video loaded, risk lenses in standby.</p>
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-[10px] text-neutral-400 block mb-0.5">
              Operator Action
            </span>
            <p className="text-ink font-medium">Enable the "Risk findings" toggle below the player to start automated evaluation.</p>
          </div>
        </div>
      </div>
    )
  }

  // 3. Loading findings
  if (loading) {
    return (
      <div className="border border-line bg-white p-4 mb-4 text-xs">
        <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
          <div>
            <h3 className="font-bold text-sm text-ink tracking-tight">TRACE Live Analysis</h3>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Source: <strong className="text-ink">{video.filename}</strong> · Frame: {formatTime(currentTime)}
            </p>
          </div>
          <span className="border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 uppercase flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            Evaluating…
          </span>
        </div>
        <p className="text-neutral-500">
          Running spatial relationship graph and kinematic trajectory evaluation for the current frame…
        </p>
      </div>
    )
  }

  // 4. Normal Operation (no findings at current frame)
  if (!findings || findings.length === 0) {
    return (
      <div className="border border-emerald-300 bg-emerald-50/30 p-4 mb-4 text-xs">
        <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2 mb-3">
          <div>
            <h3 className="font-bold text-sm text-ink tracking-tight">TRACE Live Analysis</h3>
            <p className="text-[11px] text-neutral-600 mt-0.5">
              Source: <strong className="text-ink">{video.filename}</strong> · Frame: {formatTime(currentTime)} ({currentTime.toFixed(1)}s)
            </p>
          </div>
          <span className="border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 uppercase">
            ✓ Normal Operation
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="border border-emerald-200/70 bg-white p-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
              1. What TRACE Sees
            </span>
            <p className="text-ink font-medium leading-snug">
              No structural, behavioural, or conformance hazards detected.
            </p>
          </div>

          <div className="border border-emerald-200/70 bg-white p-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
              2. Confidence Level
            </span>
            <span className="inline-block border border-emerald-300 bg-emerald-50 text-emerald-800 font-mono font-bold text-[10px] px-1.5 py-0.2 uppercase">
              Nominal Status
            </span>
            <p className="text-[11px] text-neutral-500 mt-1 leading-snug">
              All tracked entities within safety thresholds.
            </p>
          </div>

          <div className="border border-emerald-200/70 bg-white p-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
              3. Safe Action Now
            </span>
            <p className="text-ink font-semibold leading-snug">
              Continue standard handling.
            </p>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Maintain current workflow clearance.
            </p>
          </div>

          <div className="border border-emerald-200/70 bg-white p-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
              4. Operational Basis
            </span>
            <p className="text-neutral-600 text-[11px] leading-snug">
              Spatial graph and velocity metrics clear of risk triggers.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // 5. Active Risk Finding Detected
  const sorted = [...findings].sort((a, b) => getFindingPriorityScore(b) - getFindingPriorityScore(a))
  const primary = sorted[0]
  const plan = primary.planner_recommendation
  const badge = STATUS_BADGES[primary.status] ?? STATUS_BADGES.unsupported

  const displayTitle = plan?.risk_title || primary.scenario?.replace(/_/g, ' ') || 'Observed Condition'
  const displayAction = plan?.action || primary.recommended_action || 'Verification required before physical intervention.'
  const displayWhy = plan?.rationale || (primary.limitations?.length ? primary.limitations.join('; ') : plan?.basis) || 'Derived from available multi-frame sensor evidence.'

  return (
    <div className="border border-line bg-white p-4 mb-4 text-xs shadow-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-ink tracking-tight">TRACE Live Analysis</h3>
            <span className="text-[10px] font-mono text-neutral-500">
              Frame: {formatTime(currentTime)} ({currentTime.toFixed(1)}s)
            </span>
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Source: <strong className="text-ink">{video.filename}</strong> · {findings.length} finding{findings.length === 1 ? '' : 's'} evaluated
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5 ${badge.bg}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${badge.dot}`} />
            {badge.title}
          </span>
        </div>
      </div>

      {/* 4-Step Mental Model Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* 1. WHAT TRACE SEES */}
        <div className="border border-line bg-neutral-50 p-2.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                1. What TRACE Sees
              </span>
              {findings.length > 1 && (
                <span
                  className="text-[9px] font-semibold bg-neutral-200 text-neutral-700 px-1.5 py-0.2"
                  title={`${findings.length - 1} additional observations detected at this frame (scroll to Findings Panel below for full list)`}
                >
                  +{findings.length - 1} more
                </span>
              )}
            </div>
            <p className="font-bold text-ink text-xs leading-snug">
              {displayTitle}
            </p>
            {primary.explanation && (
              <p className="text-[11px] text-neutral-600 mt-1 leading-snug line-clamp-3" title={primary.explanation}>
                {primary.explanation}
              </p>
            )}
          </div>
          <span className="text-[9px] font-mono uppercase text-neutral-400 mt-2 block">
            Lens: {primary.lens} {findings.length > 1 ? '· Primary Risk' : ''}
          </span>
        </div>

        {/* 2. HOW CERTAIN TRACE IS */}
        <div className="border border-line bg-neutral-50 p-2.5 flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">
              2. How Certain TRACE Is
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`border px-1.5 py-0.2 text-[9px] font-bold uppercase ${badge.bg}`}>
                {primary.status.replace(/_/g, ' ')}
              </span>
              {primary.confidence && (
                <span className="text-[10px] font-mono text-neutral-600">
                  {primary.confidence}
                </span>
              )}
            </div>
            <p className="text-[11px] text-neutral-600 mt-1.5 leading-snug">
              {primary.status === 'supported'
                ? 'Multi-frame visual evidence clears all confidence gates for immediate precaution.'
                : primary.status === 'probable'
                  ? 'Condition detected with probable evidence; physical verification required.'
                  : primary.status === 'insufficient_evidence'
                    ? 'Visual evidence does not meet confidence or sample threshold for direct action.'
                    : 'Condition cannot be determined safely from available sensors.'}
            </p>
          </div>
          <span className="text-[9px] font-mono uppercase text-neutral-400 mt-2 block">
            Epistemic Gated
          </span>
        </div>

        {/* 3. WHAT TO DO NOW */}
        <div className={`border p-2.5 flex flex-col justify-between ${
          primary.status === 'supported' ? 'border-emerald-400 bg-emerald-50/70' :
          primary.status === 'probable' ? 'border-amber-400 bg-amber-50/70' : 'border-line bg-neutral-50'
        }`}>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink block mb-1">
              3. What To Do Now
            </span>
            <p className="font-bold text-ink text-xs leading-snug">
              {displayAction}
            </p>
          </div>
          {plan?.what_if_eligible && (
            <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-wide mt-2 block">
              ✓ Placement What-If Available
            </span>
          )}
        </div>

        {/* 4. WHY TRACE MAY REFUSE OR CAUTION */}
        <div className="border border-line bg-neutral-50 p-2.5 flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">
              4. Why / Limitation
            </span>
            <p className="text-[11px] text-neutral-700 leading-snug">
              {displayWhy}
            </p>
          </div>
          <span className="text-[9px] text-neutral-400 mt-2 block">
            Zero Hallucination Guardrail
          </span>
        </div>
      </div>
    </div>
  )
}
