import { getFindingPriorityScore } from './FindingsPanel.jsx'
import {
  getScenarioConfig,
  STATUS_STYLES,
  RISK_BAND_STYLES,
  EPISTEMIC_LEVELS,
} from '../../lib/scenarios.js'

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
            <p className="text-ink font-medium">Enable the "Multi-Lens Risk Evaluation" toggle below to resume real-time analysis.</p>
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
              Source: <strong className="text-ink">{video.filename}</strong> · Frame: <span className="font-mono tabular-nums">{formatTime(currentTime)} ({currentTime.toFixed(1)}s)</span>
            </p>
          </div>
          <span className="border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 uppercase">
            ✓ Normal Operation
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="border border-emerald-200/70 bg-white p-2.5 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
                1. What Is Happening?
              </span>
              <p className="text-ink font-semibold leading-snug">
                Normal warehouse handling detected.
              </p>
              <p className="text-[11px] text-neutral-500 mt-1 leading-snug">
                No structural, behavioural, or conformance hazards in this frame.
              </p>
            </div>
            <span className="text-[9px] uppercase text-emerald-700 mt-2 block font-semibold">
              Clear Operation
            </span>
          </div>

          <div className="border border-emerald-200/70 bg-white p-2.5 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
                2. Why It Matters
              </span>
              <p className="text-neutral-700 font-medium leading-snug">
                All tracked items remain within calibrated safety thresholds.
              </p>
            </div>
            <span className="text-[9px] uppercase text-neutral-400 mt-2 block">
              Low Risk Baseline
            </span>
          </div>

          <div className="border border-emerald-200/70 bg-white p-2.5 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
                3. What To Do Now
              </span>
              <p className="text-ink font-semibold leading-snug">
                Continue standard workflow.
              </p>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Maintain standard aisle and staging clearances.
              </p>
            </div>
            <span className="text-[9px] uppercase text-neutral-400 mt-2 block">
              Standard Handling
            </span>
          </div>

          <div className="border border-emerald-200/70 bg-white p-2.5 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
                4. How TRACE Knows
              </span>
              <p className="text-neutral-600 text-[11px] leading-snug">
                Spatial scene graph, velocity metrics, and proximity edges nominal.
              </p>
            </div>
            <span className="text-[9px] text-emerald-700 font-bold uppercase mt-2 block">
              Multi-Lens Verified
            </span>
          </div>
        </div>
      </div>
    )
  }

  // 5. Active Risk Finding Detected
  const sorted = [...findings].sort((a, b) => getFindingPriorityScore(b) - getFindingPriorityScore(a))
  const primary = sorted[0]
  const plan = primary.planner_recommendation
  const config = getScenarioConfig(primary.scenario)
  const statusMeta = STATUS_STYLES[primary.status] || STATUS_STYLES.insufficient_evidence
  const band = primary.band || config.defaultBand || 'Medium'
  const bandStyle = RISK_BAND_STYLES[band] || RISK_BAND_STYLES.Medium
  const epistemicMeta = EPISTEMIC_LEVELS[primary.epistemic_level] || EPISTEMIC_LEVELS.INFERRED

  const displayTitle = plan?.risk_title || config.title || primary.scenario?.replace(/_/g, ' ') || 'Observed Condition'
  const displayWhy = plan?.rationale || config.whyItMatters
  const displayAction = plan?.action || primary.recommended_action || config.recommendedAction

  return (
    <div className="border border-line bg-white p-4 mb-4 text-xs shadow-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-line pb-2 mb-3 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-ink tracking-tight">TRACE Live Analysis</h3>
            <span className="text-[10px] text-neutral-500">
              Frame: <span className="font-mono tabular-nums">{formatTime(currentTime)} ({currentTime.toFixed(1)}s)</span>
            </span>
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Source: <strong className="text-ink">{video.filename}</strong> · {findings.length} finding{findings.length === 1 ? '' : 's'} evaluated
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${bandStyle.subtle}`}>
            {bandStyle.label}
          </span>
          <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5 ${statusMeta.style}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
            {statusMeta.label}
          </span>
        </div>
      </div>

      {/* 4-Step Judge-First Mental Model Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* 1. WHAT IS HAPPENING? */}
        <div className="border border-line bg-neutral-50 p-2.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                1. What Is Happening?
              </span>
              {findings.length > 1 && (
                <span
                  className="text-[9px] font-semibold bg-neutral-200 text-neutral-700 px-1.5 py-0.2"
                  title={`${findings.length - 1} additional observations detected at this frame`}
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
          <span className="text-[9px] uppercase text-neutral-400 mt-2 block">
            Lens: {primary.lens} {findings.length > 1 ? '· Primary Risk' : ''}
          </span>
        </div>

        {/* 2. WHY IT MATTERS */}
        <div className="border border-line bg-neutral-50 p-2.5 flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block mb-1">
              2. Why It Matters
            </span>
            <p className="text-[11px] text-neutral-700 leading-snug">
              {displayWhy}
            </p>
          </div>
          <span className="text-[9px] uppercase text-neutral-400 mt-2 block">
            Operational Consequence
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
              "{displayAction}"
            </p>
          </div>
          {plan?.what_if_eligible && (
            <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-wide mt-2 block">
              ✓ What-If Simulation Available
            </span>
          )}
        </div>

        {/* 4. HOW TRACE KNOWS */}
        <div className="border border-line bg-neutral-50 p-2.5 flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">
              4. How TRACE Knows
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`border px-1.5 py-0.2 text-[9px] font-bold uppercase ${statusMeta.style}`}>
                {primary.status.replace(/_/g, ' ')}
              </span>
              {primary.confidence && (
                <span className="text-[10px] font-mono tabular-nums text-neutral-600">
                  {primary.confidence}
                </span>
              )}
            </div>
            <p className="text-[11px] text-neutral-600 mt-1 leading-snug">
              {epistemicMeta.desc}
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
