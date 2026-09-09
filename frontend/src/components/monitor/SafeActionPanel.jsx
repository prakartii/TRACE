import {
  formatEvidenceKey,
  formatEvidenceValue,
  telemetryEntries,
} from '../../lib/scenarios.js'
import SupervisorRuleNotice from '../SupervisorRuleNotice.jsx'

/**
 * Renders a Safe Action plan for a selected risk. `plan` is a normalised
 * shape so the same panel serves a live finding's embedded
 * `planner_recommendation` and a persisted incident's `/api/actions/:id`:
 *
 *   { action, rationale, steps?, verification?, limitations?, whatIfEligible? }
 *
 * `finding` (or event) supplies `evidence` for the recorded-telemetry row and
 * the supervisor-rule notice. Nothing here is fabricated — a field the API did
 * not return is simply not shown.
 */
export default function SafeActionPanel({ title, plan, finding, onSimulate }) {
  if (!plan || !plan.action) return null

  const evidence = finding?.evidence || {}
  const metrics = telemetryEntries(evidence).slice(0, 4)
  const steps = (plan.steps || []).filter(Boolean)
  const limitations = plan.limitations || []

  return (
    <div className="panel">
      <span className="eyebrow mb-3 block">Safe action{title ? ` — ${title}` : ''}</span>

      {plan.rationale && (
        <p className="mb-3 text-body text-dim">
          <span className="font-medium text-ink">Why: </span>
          {plan.rationale}
        </p>
      )}

      <p className="text-body">
        <span className="font-medium">Do this: </span>
        {plan.action}
      </p>

      {steps.length > 1 && (
        <ol className="mt-2 flex flex-col gap-1">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-caption text-dim">
              <span className="font-mono text-mute">{i + 1}.</span>
              <span>{s.replace(/^\d+\.\s*/, '')}</span>
            </li>
          ))}
        </ol>
      )}

      {plan.verification && (
        <p className="mt-3 text-caption text-dim">
          <span className="text-ok">&#10003; verify: </span>
          {plan.verification}
        </p>
      )}

      {metrics.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
          {metrics.map(([k, v]) => (
            <div key={k}>
              <dt className="text-label text-mute">{formatEvidenceKey(k)}</dt>
              <dd className="font-mono text-caption tabular-nums">{formatEvidenceValue(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}

      <SupervisorRuleNotice evidence={evidence} className="mt-3" />

      {limitations.length > 0 && (
        <p className="mt-3 border-l-2 border-line-strong pl-2.5 text-label text-mute">
          {limitations.join(' · ')}
        </p>
      )}

      {onSimulate && plan.whatIfEligible && (
        <button
          type="button"
          onClick={onSimulate}
          className="mt-3 rounded-md border border-line-strong bg-bg px-3 py-1.5 text-caption text-dim transition-colors hover:text-ink"
        >
          simulate alternative &rarr;
        </button>
      )}
    </div>
  )
}
