import { useEffect, useState } from 'react'
import { Repeat, Grid3x3, GraduationCap } from 'lucide-react'
import { getHeatmap, getPatterns, getScorecards } from '../api/learning.js'

// Learning / Pattern Memory (Layer 9). Self-contained: fetches its own data and
// renders nothing until it has some, so it can be dropped into the Dashboard
// without touching the rest of that screen.

function shortScenario(s) {
  return (s || '')
    .replace(/_precursor$/, '')
    .replace(/^entity_in_/, '')
    .replace(/_zone$/, '')
    .replace(/_/g, ' ')
}

function shortSource(s) {
  const noExt = (s || '').replace(/\.mp4$/i, '')
  return noExt.length > 26 ? noExt.slice(0, 24) + '…' : noExt
}

export default function LearningInsights() {
  const [patterns, setPatterns] = useState(null)
  const [heatmap, setHeatmap] = useState(null)
  const [scorecards, setScorecards] = useState(null)

  useEffect(() => {
    getPatterns().then(setPatterns).catch(() => {})
    getHeatmap().then(setHeatmap).catch(() => {})
    getScorecards().then((d) => setScorecards(d.scorecards)).catch(() => {})
  }, [])

  if (!patterns && !heatmap) return null

  const recurring = patterns?.recurring_scenarios || []
  const recs = patterns?.training_recommendations || []
  const cellByKey = {}
  ;(heatmap?.cells || []).forEach((c) => {
    cellByKey[`${c.source}::${c.scenario}`] = c
  })
  const maxCell = heatmap?.max_cell_count || 1

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-bold text-ink">Pattern memory</h2>
        <span className="font-mono text-caption text-ink-faint">
          aggregated from the event log — no autonomous learning
        </span>
      </div>

      {/* heat map */}
      {heatmap && heatmap.sources.length > 0 && (
        <div className="border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <Grid3x3 size={14} className="text-ink-soft" />
            <h3 className="font-mono text-caption font-semibold uppercase tracking-wider text-ink">
              risk density — source × scenario
            </h3>
          </div>
          <div className="overflow-x-auto p-4">
            <table className="border-collapse text-caption">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-surface p-1.5 text-left font-medium text-ink-faint">
                    source \ scenario
                  </th>
                  {heatmap.scenarios.map((s) => (
                    <th key={s} className="p-1.5 text-left font-medium text-ink-faint">
                      <span className="inline-block w-16 leading-tight">{shortScenario(s)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.sources.map((src) => (
                  <tr key={src}>
                    <td className="sticky left-0 max-w-[13rem] truncate bg-surface p-1.5 font-medium text-ink">
                      {shortSource(src)}
                    </td>
                    {heatmap.scenarios.map((scen) => {
                      const c = cellByKey[`${src}::${scen}`]
                      const n = c?.count || 0
                      const hi = c?.high_count || 0
                      const alpha = n ? 0.12 + 0.6 * (n / maxCell) : 0
                      return (
                        <td
                          key={scen}
                          title={n ? `${src} · ${scen}: ${n} event(s), ${hi} High/Critical` : ''}
                          className="border border-line/60 p-0"
                        >
                          <div
                            className="flex h-7 w-full min-w-[3rem] items-center justify-center font-mono tabular-nums"
                            style={{ backgroundColor: n ? `rgba(178,58,34,${alpha})` : 'transparent' }}
                          >
                            {n ? (
                              <span className={hi ? 'font-bold text-danger' : 'text-ink-soft'}>{n}</span>
                            ) : (
                              <span className="text-ink-faint">·</span>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-caption text-ink-faint">
              Cell = event count; shading scales with count; <span className="font-bold text-danger">bold</span>{' '}
              means the cell includes a High/Critical event. {heatmap.basis}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* recurring */}
        <div className="border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <Repeat size={14} className="text-ink-soft" />
            <h3 className="font-mono text-caption font-semibold uppercase tracking-wider text-ink">
              recurring configurations
            </h3>
          </div>
          <div className="p-4">
            {recurring.length === 0 ? (
              <p className="text-small text-ink-soft">No scenario has recurred yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recurring.map((r) => (
                  <li key={r.scenario} className="flex items-baseline justify-between gap-3 text-small">
                    <span className="text-ink">{shortScenario(r.scenario)}</span>
                    <span className="font-mono text-caption text-ink-faint">
                      {r.count}× · {r.high_count} High/Crit · {r.source_count} source
                      {r.source_count === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* training recommendations */}
        <div className="border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <GraduationCap size={14} className="text-ink-soft" />
            <h3 className="font-mono text-caption font-semibold uppercase tracking-wider text-ink">
              training recommendations
            </h3>
          </div>
          <div className="p-4">
            {recs.length === 0 ? (
              <p className="text-small text-ink-soft">
                Nothing has recurred often enough to suggest team coaching.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {recs.map((r) => (
                  <li key={r.scenario} className="border-l-2 border-ok bg-ok/5 px-3 py-2 text-caption text-ink">
                    {r.priority === 'high' && (
                      <span className="mr-1.5 border border-danger/40 bg-danger/10 px-1 py-0.5 text-label font-medium text-danger">
                        priority
                      </span>
                    )}
                    {r.suggestion}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* process scorecards */}
      {scorecards && scorecards.length > 0 && (
        <div className="border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h3 className="font-mono text-caption font-semibold uppercase tracking-wider text-ink">
              process scorecards
            </h3>
            <span className="text-caption text-ink-faint">per source / process — never per worker</span>
          </div>
          <div className="overflow-x-auto p-4">
            <table className="w-full text-left text-small">
              <thead>
                <tr className="border-b border-line text-caption text-ink-faint">
                  <th className="py-1.5 font-medium">source</th>
                  <th className="py-1.5 font-medium">events</th>
                  <th className="py-1.5 font-medium">High/Crit</th>
                  <th className="py-1.5 font-medium">prevented</th>
                  <th className="py-1.5 font-medium">near-miss</th>
                  <th className="py-1.5 font-medium">most common</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {scorecards.map((c) => (
                  <tr key={c.video_id} className="hover:bg-paper">
                    <td className="py-1.5 text-ink">{shortSource(c.source)}</td>
                    <td className="py-1.5 font-mono tabular-nums">{c.events}</td>
                    <td className="py-1.5 font-mono tabular-nums text-danger">{c.high_events}</td>
                    <td className="py-1.5 font-mono tabular-nums text-ok">{c.prevented}</td>
                    <td className="py-1.5 font-mono tabular-nums text-[#8a5f00]">{c.near_miss}</td>
                    <td className="py-1.5 text-ink-soft">{shortScenario(c.top_scenario)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
