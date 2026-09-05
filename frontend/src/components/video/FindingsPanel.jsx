const STATUS_STYLE = {
  supported: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  probable: 'border-amber-300 bg-amber-50 text-amber-700',
  insufficient_evidence: 'border-line bg-neutral-50 text-neutral-500',
  unsupported: 'border-line bg-neutral-50 text-neutral-400',
}

const STATUS_LABEL = {
  supported: 'SUPPORTED FINDING',
  probable: 'PROBABLE FINDING',
  insufficient_evidence: 'INSUFFICIENT EVIDENCE',
  unsupported: 'UNSUPPORTED SCENARIO',
}

function StatusBadge({ status }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.insufficient_evidence
  const label = STATUS_LABEL[status] ?? status.toUpperCase()
  return (
    <span className={`border px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${style}`}>
      {label}
    </span>
  )
}

function Finding({ finding }) {
  return (
    <div className="border border-line bg-white p-2.5 text-xs">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <StatusBadge status={finding.status} />
        <span className="text-[11px] uppercase tracking-wide text-neutral-400">{finding.lens}</span>
      </div>
      {finding.scenario && (
        <p className="mb-1 font-medium text-ink">{finding.scenario.replace(/_/g, ' ')}</p>
      )}
      <p className="leading-relaxed text-neutral-600">{finding.explanation}</p>
      {finding.entities?.length > 0 && (
        <p className="mt-1 text-[11px] text-neutral-400">entities: {finding.entities.join(', ')}</p>
      )}
      <p className="mt-1 text-[11px] text-neutral-400">confidence: {finding.confidence}</p>
      {finding.recommended_action && (
        <p className="mt-1.5 border-t border-line pt-1.5 text-ink">
          <span className="font-medium">Recommended: </span>
          {finding.recommended_action}
        </p>
      )}
      {finding.limitations?.length > 0 && (
        <p className="mt-1 text-[11px] text-neutral-400">
          limitations: {finding.limitations.join(', ')}
        </p>
      )}
    </div>
  )
}

// Renders the Phase 5 evidence-aware findings for the current frame.
// Deliberately plain — status badges + text, reusing the same
// border/neutral visual language as MetadataPanel, no dashboard redesign,
// no gradients, no fabricated severity scores.
export default function FindingsPanel({ findings, loading, error }) {
  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (loading) return <p className="text-xs text-neutral-500">Evaluating risk lenses…</p>
  if (!findings || findings.length === 0) {
    return <p className="text-xs text-neutral-500">No findings for this frame.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {findings.map((finding, index) => (
        <Finding key={index} finding={finding} />
      ))}
    </div>
  )
}
