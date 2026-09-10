import { useEffect, useState } from 'react'
import { ChevronDown, GraduationCap, MapPinned, Repeat } from 'lucide-react'
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
  const [showHeatmap, setShowHeatmap] = useState(false)

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
      <div>
        <h2 className="text-xl font-bold text-ink">Prevention & Learning</h2>
        <p className="mt-0.5 text-small text-ink-soft">
          What keeps happening, where it happens, and what to coach the team on next.
        </p>
      </div>

      {/* training recommendations — the actionable takeaway, shown first */}
      <div className="border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <GraduationCap size={14} className="text-ink-soft" />
          <h3 className="text-caption font-bold uppercase tracking-wider text-ink">
            Training Recommendations
          </h3>
        </div>
        <div className="p-4">
          {recs.length === 0 ? (
            <p className="text-small text-ink-soft">
              Nothing has recurred often enough yet to suggest team coaching.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {recs.map((r) => (
                <li key={r.scenario} className="border-l-2 border-ok bg-ok/5 px-3 py-2 text-small text-ink">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* recurring */}
        <div className="border border-line bg-surface">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <Repeat size={14} className="text-ink-soft" />
            <h3 className="text-caption font-bold uppercase tracking-wider text-ink">
              What Keeps Recurring
            </h3>
          </div>
          <div className="p-4">
            {recurring.length === 0 ? (
              <p className="text-small text-ink-soft">Nothing has recurred yet.</p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {recurring.map((r) => (
                    <li key={r.scenario} className="flex items-baseline justify-between gap-3 text-small">
                      <span className="text-ink capitalize">{shortScenario(r.scenario)}</span>
                      <span className="font-mono text-caption text-ink-faint">
                        {r.count} detections · {r.source_count} camera{r.source_count === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-line pt-2 text-[11px] text-ink-faint">
                  A busy few seconds on camera can produce several detections of the same situation —
                  counts here track how often an issue comes up, not a separate-incident tally.
                </p>
              </>
            )}
          </div>
        </div>

        {/* process scorecards */}
        {scorecards && scorecards.length > 0 && (
          <div className="border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h3 className="text-caption font-bold uppercase tracking-wider text-ink">
                By Camera
              </h3>
              <span className="text-[11px] text-ink-faint">per camera — never per worker</span>
            </div>
            <div className="overflow-x-auto p-3">
              <table className="w-full text-left text-small">
                <thead>
                  <tr className="border-b border-line text-caption text-ink-faint">
                    <th className="py-1.5 pr-2 font-medium">camera</th>
                    <th className="py-1.5 pr-2 font-medium">high-risk</th>
                    <th className="py-1.5 pr-2 font-medium">prevented</th>
                    <th className="py-1.5 font-medium">most common</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {scorecards.map((c) => (
                    <tr key={c.video_id} className="hover:bg-paper">
                      <td className="py-1.5 pr-2 text-ink">{shortSource(c.source)}</td>
                      <td className="py-1.5 pr-2 font-mono tabular-nums text-danger">{c.high_events}</td>
                      <td className="py-1.5 pr-2 font-mono tabular-nums text-ok">{c.prevented}</td>
                      <td className="py-1.5 text-ink-soft capitalize">{shortScenario(c.top_scenario)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* heat map — the most technically dense view, tucked behind a toggle */}
      {heatmap && heatmap.sources.length > 0 && (
        <div className="border border-line bg-surface">
          <button
            type="button"
            onClick={() => setShowHeatmap((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left cursor-pointer"
          >
            <span className="flex items-center gap-2 text-caption font-bold uppercase tracking-wider text-ink">
              <MapPinned size={14} className="text-ink-soft" />
              Detailed Camera × Issue Breakdown
            </span>
            <ChevronDown size={14} className={`text-ink-soft transition-transform ${showHeatmap ? 'rotate-180' : ''}`} />
          </button>
          {showHeatmap && (
            <div className="overflow-x-auto border-t border-line p-4">
              <table className="border-collapse text-caption">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-surface p-1.5 text-left font-medium text-ink-faint">
                      camera \ issue
                    </th>
                    {heatmap.scenarios.map((s) => (
                      <th key={s} className="p-1.5 text-left font-medium text-ink-faint">
                        <span className="inline-block w-16 leading-tight capitalize">{shortScenario(s)}</span>
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
                            title={n ? `${src} - ${scen}: ${n} detection(s), ${hi} High/Critical` : ''}
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
                Each cell is a detection count, not a distinct-incident count — repeated detections of one
                ongoing situation add up. <span className="font-bold text-danger">Bold</span> means the cell
                includes a High/Critical detection.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
