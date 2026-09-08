import { supervisorRulesFrom } from '../lib/scenarios'

/**
 * Shows why a finding's severity is higher than the risk lenses alone produced.
 *
 * CLAUDE.md §17 lets a supervisor rule raise a band at runtime; §30 requires
 * that never happen silently. Every escalation names the rule that caused it
 * and the band it moved, and is labelled INFERRED — an operator policy applied
 * to evidence, not a new observation.
 */
export default function SupervisorRuleNotice({ evidence, className = '' }) {
  const rules = supervisorRulesFrom(evidence)
  if (rules.length === 0) return null

  return (
    <div className={`border border-line bg-paper p-3 ${className}`}>
      <span className="block text-label font-medium text-ink-soft">
        supervisor rule{rules.length === 1 ? '' : 's'} applied
      </span>
      <ul className="mt-1.5 flex flex-col gap-2">
        {rules.map((r, i) => (
          <li key={r.rule_id ?? i} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-caption font-medium text-ink">{r.rule_name || 'Unnamed rule'}</span>
              {r.band_raised_to && (
                <span className="shrink-0 font-mono text-label tabular-nums text-ink-soft">
                  {r.band_raised_from} → {r.band_raised_to}
                </span>
              )}
            </div>
            {r.action_text && <p className="text-caption text-ink-soft">{r.action_text}</p>}
            <p className="text-label text-ink-soft">
              {r.band_raised_to
                ? 'Severity raised by operator policy. Risk lenses are unchanged.'
                : 'Operator rule matched. Severity unchanged.'}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
