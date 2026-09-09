import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listEvents } from '../api/events.js'
import { listOutcomes } from '../api/measurement.js'
import { listVideos } from '../api/videos.js'
import { formatTimestamp, getScenarioConfig } from '../lib/scenarios.js'
import IncidentFilterBar, { toApiFilters } from '../components/incidents/IncidentFilterBar.jsx'

const BAND_TEXT = {
  Critical: 'text-crit',
  High: 'text-high',
  Medium: 'text-dim',
  Low: 'text-mute',
}
const OUTCOME_TEXT = {
  prevented: 'text-ok',
  near_miss: 'text-dim',
  confirmed_damage: 'text-crit',
  outcome_unclear: 'text-mute',
}
const PAGE = 50
const EMPTY = { lens: '', band: '', status: '', videoId: '', review: '' }

export default function Incidents() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState(EMPTY)
  const [page, setPage] = useState(0)
  const [events, setEvents] = useState([])
  const [outcomes, setOutcomes] = useState({})
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const apiFilters = useMemo(() => toApiFilters(filters), [filters])

  useEffect(() => {
    listVideos().then(setVideos).catch(() => setVideos([]))
    listOutcomes()
      .then((rows) => {
        const m = {}
        for (const r of rows || []) m[r.event_id] = r.classification
        setOutcomes(m)
      })
      .catch(() => setOutcomes({}))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listEvents({ ...apiFilters, limit: PAGE, offset: page * PAGE, order: 'desc' })
      .then((rows) => !cancelled && setEvents(rows || []))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [apiFilters, page])

  useEffect(() => setPage(0), [filters])

  const outcomeLabel = (id) => {
    const c = outcomes[id]
    if (!c) return null
    return { text: c.replace(/_/g, ' '), cls: OUTCOME_TEXT[c] || 'text-dim', check: c === 'prevented' }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-page font-semibold">Incidents</h1>

      <IncidentFilterBar
        value={filters}
        onChange={setFilters}
        videos={videos}
        activeFilters={apiFilters}
      />

      {error && <p className="text-caption text-crit">[error] {error}</p>}

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="bg-raised text-left">
              {['id', 'finding', 'band', 'status', 'review / outcome'].map((h) => (
                <th
                  key={h}
                  className="border-b border-line px-3 py-2.5 text-label font-semibold uppercase tracking-[0.04em] text-mute"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-caption text-mute">
                  loading…
                </td>
              </tr>
            )}
            {!loading && events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-caption text-mute">
                  No incidents match these filters.
                </td>
              </tr>
            )}
            {!loading &&
              events.map((ev) => {
                const cfg = getScenarioConfig(ev.scenario)
                const band = ev.band || cfg.defaultBand || 'Medium'
                const outcome = outcomeLabel(ev.event_id)
                return (
                  <tr
                    key={ev.event_id}
                    onClick={() => navigate(`/incidents/${ev.event_id}`)}
                    className="cursor-pointer border-b border-line last:border-b-0 hover:bg-raised"
                  >
                    <td className="px-3 py-2.5 font-mono text-dim">#{ev.event_id}</td>
                    <td className="px-3 py-2.5" title={ev.scenario || ''}>
                      {cfg.title}
                      <span className="ml-2 font-mono text-label text-mute">
                        {formatTimestamp(ev.timestamp)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`font-mono text-label font-semibold tracking-[0.04em] ${BAND_TEXT[band] || 'text-dim'}`}>
                        {band.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-caption text-dim">{ev.status}</td>
                    <td className="px-3 py-2.5 text-caption">
                      {outcome ? (
                        <span className={`font-mono ${outcome.cls}`}>
                          {outcome.text}
                          {outcome.check ? ' ✓' : ''}
                        </span>
                      ) : ev.review_status && ev.review_status !== 'unresolved' ? (
                        <span className="text-dim">{ev.review_status.replace(/_/g, ' ')}</span>
                      ) : (
                        <span className="text-mute">unreviewed</span>
                      )}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between font-mono text-label text-mute">
        <span>
          {events.length} shown{page > 0 ? ` · page ${page + 1}` : ''}
        </span>
        <span className="flex gap-3">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="disabled:opacity-40"
          >
            ← prev
          </button>
          <button
            type="button"
            disabled={events.length < PAGE}
            onClick={() => setPage((p) => p + 1)}
            className="disabled:opacity-40"
          >
            next →
          </button>
        </span>
      </div>
    </div>
  )
}
