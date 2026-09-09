/**
 * The real three-condition prevention check (CLAUDE.md §15). All three must
 * hold before an outcome may be classified "prevented". Rendered from the
 * stored `three_condition_check`, never hard-coded.
 */
export default function OutcomeCheck({ outcome, verifying, onVerify }) {
  if (!outcome) {
    return (
      <div className="panel">
        <span className="eyebrow mb-2 block">Outcome check</span>
        <p className="mb-3 text-caption text-dim">
          No outcome has been verified for this incident. Evaluating checks the subsequent video
          frames against the three conditions.
        </p>
        <button
          type="button"
          disabled={verifying}
          onClick={onVerify}
          className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-caption text-dim hover:text-ink disabled:opacity-50"
        >
          {verifying ? 'verifying…' : 'verify post-action outcome'}
        </button>
      </div>
    )
  }

  const conditions = Object.values(outcome.three_condition_check || {})
    .filter((c) => c && typeof c === 'object' && c.condition_number)
    .sort((a, b) => a.condition_number - b.condition_number)

  const prevented = outcome.classification === 'prevented'

  return (
    <div className="panel">
      <span className="eyebrow mb-2 block">Outcome check &mdash; three conditions</span>

      {conditions.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {conditions.map((c) => (
            <li key={c.condition_number} className="flex items-start gap-2 text-caption">
              <span
                className={`mt-px shrink-0 font-mono font-semibold ${
                  c.satisfied ? 'text-ok' : 'text-mute'
                }`}
              >
                {c.satisfied ? '✓' : '✕'} {c.condition_number}
              </span>
              <span>
                <span className="font-medium">{c.name}</span>
                {c.description && <span className="text-dim"> &mdash; {c.description}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-caption text-mute">No per-condition record was stored for this outcome.</p>
      )}

      <p className={`mt-3 border-t border-line pt-2 font-mono text-caption ${prevented ? 'text-ok' : 'text-dim'}`}>
        &rarr; classification: {outcome.classification.replace(/_/g, ' ')}
        {outcome.response_window_sec != null &&
          ` · response window ${Number(outcome.response_window_sec).toFixed(1)}s`}
        {outcome.human_review_status && ` · human review: ${outcome.human_review_status}`}
      </p>

      {outcome.explanation && (
        <p className="mt-2 text-caption text-dim">{outcome.explanation}</p>
      )}
    </div>
  )
}
