import { formatTimestamp, getScenarioConfig } from '../../lib/scenarios.js'

const BAND_TEXT = {
  Critical: 'text-crit',
  High: 'text-high',
  Medium: 'text-dim',
  Low: 'text-mute',
}
const BAND_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1 }
const STATUS_RANK = { supported: 4, probable: 3, insufficient_evidence: 2, unsupported: 1 }

export function findingKey(f) {
  return `${f.scenario || 'unknown'}:${f.entity_id || ''}`
}

// Rank by band, then evidence status, then score — highest concern first.
function rank(a, b) {
  const band = (BAND_RANK[b.band] || 0) - (BAND_RANK[a.band] || 0)
  if (band) return band
  const status = (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0)
  if (status) return status
  return (b.score || 0) - (a.score || 0)
}

export default function RiskList({ findings, loading, error, selectedKey, onSelect }) {
  const ranked = [...(findings || [])].sort(rank)

  return (
    <div className="panel">
      <span className="eyebrow mb-3 block">
        Active risks{ranked.length ? ` (${ranked.length})` : ''}
      </span>

      {loading && <p className="text-caption text-mute">evaluating…</p>}
      {error && <p className="text-caption text-crit">{error}</p>}
      {!loading && !error && ranked.length === 0 && (
        <p className="text-caption text-mute">No risks at this frame.</p>
      )}

      {ranked.length > 0 && (
        <ul className="flex flex-col">
          {ranked.map((f) => {
            const key = findingKey(f)
            const cfg = getScenarioConfig(f.scenario)
            const band = f.band || cfg.defaultBand || 'Medium'
            const selected = key === selectedKey
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onSelect(f, key)}
                  className={`flex w-full flex-col gap-0.5 border-b border-line py-2.5 text-left last:border-b-0 ${
                    selected ? 'bg-bg pl-2.5 shadow-[inset_2px_0_0_theme(colors.ink)]' : ''
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-body">{cfg.title}</span>
                    <span
                      className={`shrink-0 font-mono text-label font-semibold tracking-[0.04em] ${
                        BAND_TEXT[band] || 'text-dim'
                      }`}
                    >
                      {band.toUpperCase()}
                    </span>
                  </span>
                  <span className="font-mono text-label text-mute">
                    {formatTimestamp(f.timestamp)} &middot; {f.lens} &middot; {f.status}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
