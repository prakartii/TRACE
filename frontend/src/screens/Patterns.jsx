import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { getShiftSummary, incidentsCsvUrl, shiftSummaryMdUrl } from '../api/reports.js'
import { getHeatmap } from '../api/learning.js'
import { CANONICAL_14_SCENARIOS } from '../lib/scenarios.js'

function Bucket({ n, label, tone }) {
  return (
    <div className="bg-raised px-4 py-3">
      <span className={`block text-[20px] font-semibold tabular-nums ${tone || ''}`}>{n}</span>
      <span className="mt-1 block text-label text-mute">{label}</span>
    </div>
  )
}

function ScenarioTable({ rows, cols }) {
  return (
    <table className="w-full border-collapse text-caption">
      <tbody>
        {rows.map((r) => (
          <tr key={r.scenario} className="border-b border-line last:border-b-0">
            <td className="py-1.5 pr-3">{r.scenario}</td>
            {cols.map((c) => (
              <td key={c.key} className="py-1.5 pr-3 text-right font-mono tabular-nums text-dim">
                {c.render(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function HeatCell({ count, max }) {
  if (!count) return <td className="border border-line px-2.5 py-1.5 text-center font-mono text-label text-mute">·</td>
  const t = max ? count / max : 0
  const bg = t > 0.66 ? '#ececec' : t > 0.33 ? '#f2f2f2' : '#f8f8f8'
  return (
    <td
      className="border border-line px-2.5 py-1.5 text-center font-mono text-label text-ink"
      style={{ background: bg }}
    >
      {count}
    </td>
  )
}

export default function Patterns() {
  const [summary, setSummary] = useState(null)
  const [heatmap, setHeatmap] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([getShiftSummary(), getHeatmap().catch(() => null)])
      .then(([s, h]) => {
        setSummary(s)
        setHeatmap(h)
      })
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p className="text-caption text-crit">[error] {error}</p>
  if (!summary) return <p className="text-caption text-mute">loading…</p>

  const t = summary.totals || {}
  const p = summary.prevention || {}
  const coverageDemonstrated = CANONICAL_14_SCENARIOS.filter((s) => s.status === 'DEMONSTRATED').length

  const heatCell = (source, scenario) =>
    heatmap?.cells?.find((c) => c.source === source && c.scenario === scenario)?.count || 0

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-page font-semibold">Patterns</h1>

      <section className="panel">
        <span className="eyebrow mb-3 block">Prevention &mdash; four buckets, never summed</span>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
          <Bucket n={p.prevented ?? 0} label="prevented" tone="text-ok" />
          <Bucket n={p.near_miss ?? 0} label="near-miss" />
          <Bucket n={p.outcome_unclear ?? 0} label="unclear" />
          <Bucket n={p.confirmed_damage ?? 0} label="confirmed damage" tone={p.confirmed_damage ? 'text-crit' : ''} />
        </div>
        {p.note && <p className="mt-2 text-label text-mute">{p.note}</p>}
      </section>

      <section className="panel">
        <span className="eyebrow mb-3 block">Evidence base</span>
        <div className="flex gap-8">
          <div>
            <div className="text-[20px] font-semibold tabular-nums">{t.evidence_backed_findings ?? 0}</div>
            <div className="text-label text-mute">evidence-backed findings</div>
          </div>
          <div>
            <div className="text-[20px] font-semibold tabular-nums text-dim">{t.logged_observations ?? 0}</div>
            <div className="text-label text-mute">logged observations</div>
          </div>
          <div>
            <div className="text-[20px] font-semibold tabular-nums">{t.high_or_critical ?? 0}</div>
            <div className="text-label text-mute">High / Critical</div>
          </div>
        </div>
        {t.basis && <p className="mt-2 text-label text-mute">{t.basis}</p>}
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="panel">
          <span className="eyebrow mb-3 block">Recurring configurations</span>
          <ScenarioTable
            rows={summary.recurring_scenarios || []}
            cols={[
              { key: 'count', render: (r) => `×${r.count}` },
              { key: 'high', render: (r) => `${r.high_count} high` },
            ]}
          />
        </section>
        <section className="panel">
          <span className="eyebrow mb-3 block">Behaviour frequency</span>
          <ScenarioTable
            rows={summary.behaviour_frequency || []}
            cols={[{ key: 'count', render: (r) => `×${r.count}` }]}
          />
        </section>
      </div>

      {(summary.training_recommendations || []).length > 0 && (
        <section className="panel">
          <span className="eyebrow mb-3 block">Training recommendations</span>
          <ul className="flex flex-col gap-2 text-caption">
            {summary.training_recommendations.map((r) => (
              <li key={r.scenario} className="flex flex-col gap-0.5">
                <span>
                  <span className="font-medium">{r.scenario}</span>
                  <span className="ml-2 font-mono text-label text-mute">
                    {r.priority} priority &middot; ×{r.count}
                  </span>
                </span>
                <span className="text-dim">{r.suggestion}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {heatmap?.sources?.length > 0 && (
        <section className="panel">
          <span className="eyebrow mb-3 block">Source &times; scenario heat map</span>
          <div className="overflow-x-auto">
            <table className="border-collapse text-label">
              <thead>
                <tr>
                  <th className="border border-line px-2.5 py-1.5 text-left font-mono font-normal text-mute" />
                  {heatmap.scenarios.map((s) => (
                    <th
                      key={s}
                      className="border border-line px-2.5 py-1.5 text-left font-mono font-normal text-mute"
                    >
                      {s.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.sources.map((src) => (
                  <tr key={src}>
                    <td className="border border-line px-2.5 py-1.5 font-mono text-dim">{src}</td>
                    {heatmap.scenarios.map((s) => (
                      <HeatCell key={s} count={heatCell(src, s)} max={heatmap.max_cell_count} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-label text-mute">
            Grouped by source and scenario &mdash; not a spatial pixel map.
          </p>
        </section>
      )}

      {(summary.process_scorecards || []).length > 0 && (
        <section className="panel">
          <span className="eyebrow mb-3 block">Process scorecards</span>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-caption">
              <thead>
                <tr className="text-left text-label uppercase tracking-[0.04em] text-mute">
                  <th className="border-b border-line py-2 pr-3">source</th>
                  <th className="border-b border-line py-2 pr-3 text-right">findings</th>
                  <th className="border-b border-line py-2 pr-3 text-right">high</th>
                  <th className="border-b border-line py-2 pr-3 text-right">prevented</th>
                  <th className="border-b border-line py-2 pr-3">top scenario</th>
                </tr>
              </thead>
              <tbody>
                {summary.process_scorecards.map((c) => (
                  <tr key={c.video_id} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3">{c.source}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{c.events}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-dim">{c.high_events}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-ok">{c.prevented}</td>
                    <td className="py-2 pr-3 font-mono text-label text-dim">{c.top_scenario || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-label text-mute">Aggregated per camera source / process &mdash; never per individual worker.</p>
        </section>
      )}

      <section className="panel">
        <span className="eyebrow mb-3 block">
          Scenario coverage &mdash; {coverageDemonstrated} of 14 demonstrated in footage
        </span>
        <div className="grid grid-cols-7 gap-1.5">
          {CANONICAL_14_SCENARIOS.map((s) => (
            <div
              key={s.number}
              title={`${s.title} — ${s.lens} — ${s.status.toLowerCase()}`}
              className={`flex h-9 items-center justify-center rounded border font-mono text-label ${
                s.status === 'DEMONSTRATED'
                  ? 'border-line-strong text-dim'
                  : 'border-dashed border-line-strong text-mute'
              }`}
            >
              {s.number}
            </div>
          ))}
        </div>
        <p className="mt-2 text-label text-mute">
          Dashed = implemented with validated logic but not present in the dataset (rule-ready).
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <a
          href={incidentsCsvUrl()}
          className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-bg px-3 py-1.5 text-caption text-dim hover:text-ink"
        >
          <Download size={13} />
          export incidents CSV
        </a>
        <a
          href={shiftSummaryMdUrl()}
          className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-bg px-3 py-1.5 text-caption text-dim hover:text-ink"
        >
          <Download size={13} />
          export shift summary
        </a>
      </div>

      {summary.disclosure && (
        <p className="border-l-2 border-line-strong pl-2.5 text-label text-mute">{summary.disclosure}</p>
      )}
    </div>
  )
}
