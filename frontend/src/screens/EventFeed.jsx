import { useEffect, useState, useCallback, useMemo } from 'react'
import { ArrowLeft, ArrowRight, Download, Play, RotateCcw, ShieldAlert, TriangleAlert } from 'lucide-react'
import { listEvents, getEvent, submitReview } from '../api/events.js'
import { incidentsCsvUrl } from '../api/reports.js'
import { getActionPlan } from '../api/actions.js'
import { listVideos } from '../api/videos.js'
import { getScenarioConfig, getVideoScenarioInfo, resolveIncidentTitle, formatEventRef } from '../lib/scenarios.js'
import { formatConfidence, formatEntityName, formatScore, humanizeExplanation, humanizeAction, humanizeTitle } from '../lib/format.js'
import { useIntervention } from '../context/InterventionContext.jsx'
import { useLiveViewContext } from '../LiveViewContext.jsx'


const STATUS_STYLE = {
  supported: 'border-ok/40 bg-ok/10 text-ok',
  probable: 'border-signal/40 bg-signal/10 text-[#8a5f00]',
  insufficient_evidence: 'border-line bg-paper text-ink-soft',
  unsupported: 'border-line bg-paper text-ink-faint',
}

const STATUS_LABEL = {
  supported: 'supported finding',
  probable: 'probable finding',
  insufficient_evidence: 'insufficient evidence',
  unsupported: 'unsupported scenario',
}

const BAND_STYLE = {
  Critical: 'border-danger/40 bg-danger/10 text-danger',
  High: 'border-signal/40 bg-signal/10 text-[#8a5f00]',
  Medium: 'border-steel/40 bg-steel/10 text-steel',
  Low: 'border-line-strong bg-paper text-ink-soft',
}

const REVIEW_BADGES = {
  confirmed_damage: {
    label: 'confirmed damage',
    style: 'border-danger/40 bg-danger/10 text-danger font-medium',
  },
  false_positive: {
    label: 'false positive',
    style: 'border-steel/40 bg-steel/10 text-steel font-medium',
  },
  unresolved: {
    label: 'unresolved / pending',
    style: 'border-signal/40 bg-signal/10 text-[#8a5f00] font-medium',
  },
}

function formatTimestamp(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return '00:00.0'
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(1)
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`
}

function formatEvidenceItem(key, value) {
  const cleanKey = key.replace(/_/g, ' ')
  if (typeof value === 'number') {
    if (key.includes('ratio') || key.includes('fraction') || key.includes('overlap') || key.includes('percent')) {
      return { label: cleanKey, text: `${(value * 100).toFixed(1)}%` }
    }
    return { label: cleanKey, text: Number.isInteger(value) ? `${value}` : `${value.toFixed(2)}` }
  }
  if (typeof value === 'boolean') {
    return { label: cleanKey, text: value ? 'yes' : 'no' }
  }
  if (typeof value === 'object' && value !== null) {
    return { label: cleanKey, text: JSON.stringify(value) }
  }
  return { label: cleanKey, text: String(value) }
}

export default function EventFeed() {
  const { navigateTo } = useLiveViewContext()
  const { activeAlerts, setSelectedAlert } = useIntervention()
  const [events, setEvents] = useState([])
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const activeAlertByEventId = useMemo(() => {
    const map = new Map()
    for (const alert of activeAlerts || []) {
      if (alert.event_id) map.set(alert.event_id, alert)
      for (const supId of alert.supporting_event_ids || []) {
        map.set(supId, alert)
      }
    }
    return map
  }, [activeAlerts])


  const handleReplayIncident = (ev) => {
    if (!ev) return
    navigateTo('Incident Replay', {
      eventId: ev.event_id,
      videoId: ev.video_id,
      timestamp: ev.timestamp,
      event: ev,
    })
  }

  const [groupSimilar, setGroupSimilar] = useState(true)

  const [filterLens, setFilterLens] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterBand, setFilterBand] = useState('')
  const [filterVideo, setFilterVideo] = useState('')
  const [filterReviewState, setFilterReviewState] = useState('')
  const [order, setOrder] = useState('desc')
  const [offset, setOffset] = useState(0)
  const limit = 25

  // Selected event & Safe Action Plan
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [actionPlan, setActionPlan] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)

  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewMessage, setReviewMessage] = useState(null)
  const [showTechnical, setShowTechnical] = useState(false)

  const displayedEvents = useMemo(() => {
    if (!events?.length) return []
    if (!groupSimilar) return events

    const clusters = []
    const sorted = [...events].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))

    for (const ev of sorted) {
      const last = clusters[clusters.length - 1]
      const sameVideo = last && last.video_id === ev.video_id
      const sameScenario = last && last.scenario === ev.scenario
      const withinWindow = last && Math.abs((ev.timestamp ?? 0) - last.maxTimestamp) <= 2.0

      if (sameVideo && sameScenario && withinWindow) {
        last.events.push(ev)
        last.maxTimestamp = Math.max(last.maxTimestamp, ev.timestamp ?? 0)
        const evRisk = ev.risk_score ?? (ev.band === 'Critical' ? 90 : ev.band === 'High' ? 70 : 50)
        const peakRisk = last.peakEvent.risk_score ?? (last.peakEvent.band === 'Critical' ? 90 : last.peakEvent.band === 'High' ? 70 : 50)
        if (evRisk > peakRisk) {
          last.peakEvent = ev
        }
      } else {
        clusters.push({
          video_id: ev.video_id,
          scenario: ev.scenario,
          minTimestamp: ev.timestamp ?? 0,
          maxTimestamp: ev.timestamp ?? 0,
          events: [ev],
          peakEvent: ev,
        })
      }
    }

    const results = clusters.map((cl) => ({
      ...cl.peakEvent,
      _clusterCount: cl.events.length,
      _minTimestamp: cl.minTimestamp,
      _maxTimestamp: cl.maxTimestamp,
    }))

    if (order === 'desc') {
      results.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    } else {
      results.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
    }

    return results
  }, [events, groupSimilar, order])

  useEffect(() => {
    let active = true
    listVideos()
      .then((data) => {
        if (active) setVideos(data || [])
      })
      .catch((err) => {
        console.warn('Failed to load videos for filter dropdown:', err)
      })
    return () => {
      active = false
    }
  }, [])

  // One definition of "what is currently filtered", shared by the list query
  // and the CSV export. They were built separately, and the export omitted the
  // review-state filter entirely — so "export CSV (filtered)" downloaded every
  // event while the screen showed a filtered subset.
  const activeFilters = useMemo(() => {
    const f = {}
    if (filterLens) f.lens = filterLens
    if (filterStatus) f.status = filterStatus
    if (filterBand) f.band = filterBand
    if (filterVideo) f.videoId = filterVideo
    if (filterReviewState === 'unreviewed') f.reviewed = false
    else if (filterReviewState === 'reviewed') f.reviewed = true
    else if (filterReviewState) f.reviewStatus = filterReviewState
    return f
  }, [filterLens, filterStatus, filterBand, filterVideo, filterReviewState])

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const filters = { limit, offset, order, ...activeFilters }

      const data = await listEvents(filters)
      setEvents(data)

      if (data.length > 0) {
        if (!selectedEventId || !data.some((ev) => ev.event_id === selectedEventId)) {
          setSelectedEventId(data[0].event_id)
        }
      } else {
        setSelectedEvent(null)
        setActionPlan(null)
        setSelectedEventId(null)
      }
    } catch (err) {
      setError(err.message || 'Failed to load events from backend database.')
    } finally {
      setLoading(false)
    }
  }, [activeFilters, order, offset, selectedEventId])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  // Load single event detail & Safe Action Plan when selectedEventId changes
  useEffect(() => {
    if (!selectedEventId) {
      setSelectedEvent(null)
      setActionPlan(null)
      return
    }
    let active = true
    setDetailLoading(true)
    setDetailError(null)
    setReviewMessage(null)

    // Parallel fetch: Event entity + Safe Action Plan
    Promise.all([
      getEvent(selectedEventId),
      getActionPlan(selectedEventId).catch((err) => {
        console.warn('Action plan API error, using event-derived plan:', err)
        return null
      }),
    ])
      .then(([evData, planData]) => {
        if (active) {
          setSelectedEvent(evData)
          setActionPlan(planData)
        }
      })
      .catch((err) => {
        if (active) setDetailError(err.message || 'Failed to load incident detail.')
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedEventId])

  const handleReviewSubmit = async (statusValue) => {
    if (!selectedEventId) return
    setReviewLoading(true)
    setReviewMessage(null)
    try {
      const updated = await submitReview(selectedEventId, statusValue, reviewNotes.trim() || null)
      setSelectedEvent(updated)
      setReviewMessage({
        type: 'success',
        text: `review recorded as: ${statusValue.replace(/_/g, ' ')}`,
      })
      setReviewNotes('')

      setEvents((prev) =>
        prev.map((ev) => (ev.event_id === updated.event_id ? updated : ev))
      )
    } catch (err) {
      setReviewMessage({
        type: 'error',
        text: err.message || 'Failed to submit review feedback.',
      })
    } finally {
      setReviewLoading(false)
    }
  }

  const handleResetFilters = () => {
    setFilterLens('')
    setFilterStatus('')
    setFilterBand('')
    setFilterVideo('')
    setFilterReviewState('')
    setOrder('desc')
    setOffset(0)
  }

  const activeFilterCount = [
    filterLens,
    filterStatus,
    filterBand,
    filterVideo,
    filterReviewState,
  ].filter(Boolean).length

  const getVideoInfo = (videoId, scenario = '') => getVideoScenarioInfo(videoId, scenario)
  const getVideoName = (videoId, scenario = '') => getVideoScenarioInfo(videoId, scenario).cameraName

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <section className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2 text-caption text-ink-soft">
            <button
              type="button"
              onClick={() => navigateTo('Live View')}
              className="inline-flex items-center gap-1 font-medium hover:text-ink cursor-pointer"
            >
              ← Step 1: Live Feeds
            </button>
            <span>/</span>
            <span className="font-semibold text-ink">Step 2: Active Hazards</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-ink">Active Hazards</h1>
          <p className="mt-1 max-w-2xl text-body text-ink-soft">
            Prioritized safety hazards requiring supervisor attention. Select any incident to inspect
            the operational impact, recommended safe action, and forensic replay.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={incidentsCsvUrl(activeFilters)}
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 text-caption font-medium text-ink hover:border-ink"
          >
            <Download size={13} />
            Export CSV
          </a>
          <span className="border border-line bg-paper px-3 py-1.5 font-mono text-caption text-ink font-semibold">
            {events.length} Recorded
          </span>
        </div>
      </section>

      {/* Streamlined Filter Toolbar */}
      <section className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-caption font-semibold text-ink-faint mr-1">Filter:</span>
          <button
            type="button"
            onClick={() => {
              handleResetFilters()
            }}
            className={`px-2.5 py-1 text-caption font-medium rounded-xs cursor-pointer transition-colors ${
              !filterBand && !filterLens && !filterReviewState
                ? 'bg-ink text-paper font-semibold'
                : 'border border-line bg-paper text-ink hover:border-ink'
            }`}
          >
            All Hazards
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterBand('High')
              setOffset(0)
            }}
            className={`px-2.5 py-1 text-caption font-medium rounded-xs cursor-pointer transition-colors ${
              filterBand === 'High'
                ? 'bg-signal text-ink font-bold'
                : 'border border-line bg-paper text-ink hover:border-ink'
            }`}
          >
            High &amp; Critical
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterLens(filterLens === 'structural' ? '' : 'structural')
              setOffset(0)
            }}
            className={`px-2.5 py-1 text-caption font-medium rounded-xs cursor-pointer transition-colors ${
              filterLens === 'structural'
                ? 'bg-ink text-paper font-semibold'
                : 'border border-line bg-paper text-ink hover:border-ink'
            }`}
          >
            Structural
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterLens(filterLens === 'behaviour' ? '' : 'behaviour')
              setOffset(0)
            }}
            className={`px-2.5 py-1 text-caption font-medium rounded-xs cursor-pointer transition-colors ${
              filterLens === 'behaviour'
                ? 'bg-ink text-paper font-semibold'
                : 'border border-line bg-paper text-ink hover:border-ink'
            }`}
          >
            Behaviour
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterLens(filterLens === 'environmental' ? '' : 'environmental')
              setOffset(0)
            }}
            className={`px-2.5 py-1 text-caption font-medium rounded-xs cursor-pointer transition-colors ${
              filterLens === 'environmental'
                ? 'bg-ink text-paper font-semibold'
                : 'border border-line bg-paper text-ink hover:border-ink'
            }`}
          >
            Environmental
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterReviewState(filterReviewState === 'unreviewed' ? '' : 'unreviewed')
              setOffset(0)
            }}
            className={`px-2.5 py-1 text-caption font-medium rounded-xs cursor-pointer transition-colors ${
              filterReviewState === 'unreviewed'
                ? 'bg-steel text-paper font-semibold'
                : 'border border-line bg-paper text-ink hover:border-ink'
            }`}
          >
            Needs Review
          </button>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={filterVideo}
            onChange={(e) => {
              setFilterVideo(e.target.value)
              setOffset(0)
            }}
            className="border border-line bg-paper px-2 py-1 text-caption text-ink focus:border-ink cursor-pointer"
          >
            <option value="">All Camera Bays</option>
            {videos.map((v) => {
              const info = getVideoScenarioInfo(v.id || v.filename)
              return (
                <option key={v.id} value={v.id}>
                  {info.cameraName}
                </option>
              )
            })}
          </select>

          <button
            type="button"
            onClick={() => setGroupSimilar(!groupSimilar)}
            className="text-caption text-ink-soft hover:text-ink cursor-pointer underline underline-offset-2"
          >
            {groupSimilar ? 'Grouped' : 'Raw Frames'}
          </button>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-caption text-danger hover:underline cursor-pointer flex items-center gap-1"
            >
              <RotateCcw size={11} />
              Reset ({activeFilterCount})
            </button>
          )}
        </div>
      </section>

      {/* Main Triage Workspace */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* Left Column: Prioritized Hazard List */}
        <div className="flex flex-col gap-2.5 lg:col-span-7">
          <div className="flex items-center justify-between px-1">
            <span className="text-small font-bold text-ink">
              Prioritized Hazards ({displayedEvents.length})
            </span>
            <span className="text-caption text-ink-faint">Ordered by time &amp; severity</span>
          </div>

          {loading && (
            <div className="flex items-center gap-2 border border-line bg-surface p-8 text-small text-ink-soft">
              <span className="h-4 w-4 animate-spin motion-reduce:animate-none border-2 border-ink border-t-transparent" />
              Loading hazard records…
            </div>
          )}

          {!loading && error && (
            <div className="border border-danger bg-danger/5 p-4 text-small text-danger">
              <p className="font-semibold">Error querying incident ledger</p>
              <p className="mt-1 font-mono text-caption">{error}</p>
            </div>
          )}

          {!loading && !error && displayedEvents.length === 0 && (
            <div className="border border-line bg-surface p-10 text-center text-small text-ink-soft">
              No safety hazards match the active filter criteria.
            </div>
          )}

          {!loading && !error && displayedEvents.length > 0 && (
            <div className="flex flex-col gap-2">
              {displayedEvents.map((ev) => {
                const isSelected = ev.event_id === selectedEventId
                const config = getScenarioConfig(ev.scenario)
                const title = humanizeTitle(resolveIncidentTitle(ev) || config.title || 'Observed condition', ev.scenario)
                const explanationText = humanizeExplanation(
                  ev.explanation || ev.planner_recommendation?.rationale || config.whyItMatters,
                  ev.scenario,
                  ev.entity_id
                )
                const actionText = humanizeAction(
                  ev.planner_recommendation?.action || ev.recommended_action || config.recommendedAction,
                  ev.scenario
                )
                const statusCls = STATUS_STYLE[ev.status] || STATUS_STYLE.insufficient_evidence
                const bandCls = ev.band ? BAND_STYLE[ev.band] || BAND_STYLE.Low : null
                const videoInfo = getVideoInfo(ev.video_id, ev.scenario)

                return (
                  <button
                    key={ev.event_id}
                    type="button"
                    onClick={() => setSelectedEventId(ev.event_id)}
                    className={`w-full border bg-surface p-3.5 text-left transition-all cursor-pointer rounded-xs ${
                      isSelected
                        ? 'border-ink shadow-sm ring-1 ring-ink'
                        : 'border-line hover:border-line-strong hover:bg-paper'
                    }`}
                  >
                    {/* Top Row: Severity Badge & Prevented Status */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {bandCls && (
                          <span className={`border px-2.5 py-0.5 text-label font-bold uppercase tracking-wider ${bandCls}`}>
                            {ev.band} Risk
                          </span>
                        )}
                        {ev.event_type === 'prevented' && (
                          <span className="border border-ok/40 bg-ok/10 px-1.5 py-0.5 text-label font-medium text-ok">
                            Prevented
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-caption text-ink-faint">
                        #{ev.event_id}
                      </span>
                    </div>

                    {/* Camera Bay Location with Clear Breathing Room */}
                    <div className="mt-2 text-caption font-semibold text-ink">
                      {videoInfo.cameraName}
                    </div>

                    {/* Hazard Title & One-Line Reason */}
                    <div className="mt-2">
                      <h3 className="text-small font-bold leading-snug text-ink">{title}</h3>
                      <p className="mt-0.5 text-caption text-ink-soft line-clamp-2">
                        {explanationText}
                      </p>
                    </div>

                    {/* Action Summary & Selection Indication */}
                    <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2 text-caption">
                      <div className="text-ink-soft truncate max-w-[280px]">
                        <span className="font-semibold text-ok">Action:</span> {actionText?.split('.')[0]}
                      </div>
                      <span className="text-caption font-semibold text-ink group-hover:underline inline-flex items-center gap-1">
                        Review →
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Pagination */}
          <div className="mt-1 flex items-center justify-between border border-line bg-surface px-4 py-2 text-caption">
            <span className="text-ink-faint">
              Showing {offset + 1}–{Math.min(offset + limit, offset + displayedEvents.length)} of {events.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="border border-line px-2.5 py-1 text-caption text-ink hover:bg-paper disabled:opacity-30 cursor-pointer"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={events.length < limit}
                onClick={() => setOffset(offset + limit)}
                className="border border-line px-2.5 py-1 text-caption text-ink hover:bg-paper disabled:opacity-30 cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Selected Incident Triage & Decision Panel */}
        <div className="lg:col-span-5 lg:sticky lg:top-6">
          <div className="border border-line bg-surface shadow-xs">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-signal" />
                <span className="text-small font-bold text-ink">Selected Hazard Decision</span>
              </div>
              <span className="text-caption font-medium text-ink-soft">Stage 2 Decision</span>
            </div>

            {detailLoading && (
              <div className="flex items-center gap-2 p-6 text-small text-ink-soft">
                <span className="h-4 w-4 animate-spin motion-reduce:animate-none border-2 border-ink border-t-transparent" />
                Loading hazard details…
              </div>
            )}

            {!detailLoading && detailError && (
              <div className="border-b border-danger p-4 text-small text-danger">
                <p className="font-semibold">Failed to load hazard details</p>
                <p className="mt-1 font-mono text-caption">{detailError}</p>
              </div>
            )}

            {!detailLoading && !detailError && !selectedEvent && (
              <p className="p-6 text-small text-ink-soft">
                Select a hazard from the list to view its operational impact and corrective action plan.
              </p>
            )}

            {/* Selected Hazard Triage Card */}
            {!detailLoading && !detailError && selectedEvent && (
              <div className="flex flex-col gap-4 p-4">
                {/* Hazard Overview */}
                <div className="border border-line bg-paper p-4">
                  <div className="flex items-center justify-between">
                    <span
                      className={`border px-2.5 py-1 text-label font-bold uppercase tracking-wider ${
                        BAND_STYLE[selectedEvent.band] || BAND_STYLE.Low
                      }`}
                    >
                      {selectedEvent.band || 'High'} Risk
                    </span>
                    <span className="text-caption text-ink-soft">
                      Certainty: <strong className="text-ink">{formatConfidence(selectedEvent.confidence)}</strong>
                    </span>
                  </div>
                  <div className="mt-2.5 text-caption font-medium text-ink-soft">
                    Location: <span className="font-semibold text-ink">{getVideoName(selectedEvent.video_id, selectedEvent.scenario)}</span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold text-ink leading-snug">
                    {humanizeTitle(actionPlan?.title || resolveIncidentTitle(selectedEvent), selectedEvent.scenario)}
                  </h2>
                </div>

                {/* 3. Operational Impact: Why It Matters */}
                <div className="border-l-2 border-signal bg-signal/5 p-3 text-small text-ink leading-relaxed">
                  <span className="block text-label font-bold uppercase tracking-wider text-[#8a5f00] mb-1">
                    Why This Matters (Risk)
                  </span>
                  {humanizeExplanation(
                    actionPlan?.reason || selectedEvent.planner_recommendation?.rationale || selectedEvent.explanation || getScenarioConfig(selectedEvent.scenario).whyItMatters,
                    selectedEvent.scenario,
                    selectedEvent.entity_id
                  )}
                </div>

                {/* 4. Required Safe Action */}
                <div className="border border-ok/40 bg-ok/5 p-3.5 text-small">
                  <span className="block text-label font-bold uppercase tracking-wider text-ok mb-1">
                    Required Safe Action
                  </span>
                  <p className="font-bold text-ink leading-snug">
                    "{humanizeAction(actionPlan?.immediate_action || selectedEvent.planner_recommendation?.action || getScenarioConfig(selectedEvent.scenario).recommendedAction, selectedEvent.scenario)}"
                  </p>
                </div>

                {/* 5. Primary Workflow Actions */}
                <div className="flex flex-col gap-2 pt-2 border-t border-line">
                  <button
                    type="button"
                    onClick={() => handleReplayIncident(selectedEvent)}
                    className="w-full inline-flex items-center justify-between bg-ink px-4 py-2.5 text-small font-semibold text-paper transition-colors hover:bg-ink-soft cursor-pointer shadow-xs"
                  >
                    <span className="flex items-center gap-2">
                      <Play size={14} />
                      <span>Step 3: Replay Incident Evidence</span>
                    </span>
                    <ArrowRight size={14} />
                  </button>

                  {(actionPlan?.what_if_eligible || selectedEvent.planner_recommendation?.what_if_eligible) && (
                    <button
                      type="button"
                      onClick={() => {
                        navigateTo('What-If Simulation', {
                          eventId: selectedEvent.event_id,
                          videoId: selectedEvent.video_id,
                          timestamp: selectedEvent.timestamp,
                          scenario: selectedEvent.scenario,
                          entityId: selectedEvent.entity_id,
                        })
                      }}
                      className="w-full inline-flex items-center justify-between border border-ok/40 bg-ok/10 px-4 py-2.5 text-small font-semibold text-ok transition-colors hover:bg-ok/20 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <RotateCcw size={14} />
                        <span>Step 4: Simulate Safer Placement</span>
                      </span>
                      <ArrowRight size={14} />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => navigateTo('Action Center', { eventId: selectedEvent.event_id, event: selectedEvent })}
                    className="w-full inline-flex items-center justify-between border border-line bg-paper px-4 py-2.5 text-small font-semibold text-ink transition-colors hover:border-ink cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <ShieldAlert size={14} />
                      <span>Step 5: View Safe Action Plan</span>
                    </span>
                    <ArrowRight size={14} />
                  </button>
                </div>

                {/* 6. Expandable Technical Evidence & Operator Review */}
                <div className="border-t border-line/70 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowTechnical(!showTechnical)}
                    className="flex items-center justify-between w-full text-caption text-ink-soft hover:text-ink cursor-pointer py-1"
                  >
                    <span>Supervisor Review &amp; Audit Feedback</span>
                    <span className="font-mono text-caption">{showTechnical ? '▲ collapse' : '▼ expand'}</span>
                  </button>

                  {showTechnical && (
                    <div className="mt-2.5 flex flex-col gap-3 border border-line bg-paper p-3 text-caption">
                      {/* Evidence Measurements */}
                      {selectedEvent.evidence && Object.keys(selectedEvent.evidence).length > 0 && (
                        <div>
                          <span className="font-semibold text-ink block mb-1">Measured Evidence:</span>
                          <div className="divide-y divide-line border border-line bg-surface">
                            {Object.entries(selectedEvent.evidence).map(([k, v]) => {
                              const item = formatEvidenceItem(k, v)
                              return (
                                <div key={k} className="flex justify-between px-2 py-1 font-mono text-[11px]">
                                  <span className="text-ink-soft">{item.label}:</span>
                                  <strong className="text-ink">{item.text}</strong>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Operator Review Controls */}
                      <div className="border-t border-line pt-2">
                        <span className="font-semibold text-ink block mb-1">Supervisor Review Audit:</span>
                        {reviewMessage && (
                          <div className={`p-2 mb-2 text-caption border ${reviewMessage.type === 'success' ? 'border-ok/40 bg-ok/10 text-ok' : 'border-danger bg-danger/5 text-danger'}`}>
                            {reviewMessage.text}
                          </div>
                        )}
                        <input
                          type="text"
                          placeholder="Optional audit notes…"
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          className="w-full border border-line bg-surface px-2 py-1.5 text-caption text-ink mb-2 focus:border-ink"
                        />
                        <div className="grid grid-cols-3 gap-1">
                          <button
                            type="button"
                            disabled={reviewLoading}
                            onClick={() => handleReviewSubmit('confirmed_damage')}
                            className="border border-danger/30 bg-surface px-2 py-1 text-[11px] font-medium text-danger hover:bg-danger/10 cursor-pointer disabled:opacity-50"
                          >
                            Confirmed
                          </button>
                          <button
                            type="button"
                            disabled={reviewLoading}
                            onClick={() => handleReviewSubmit('false_positive')}
                            className="border border-line bg-surface px-2 py-1 text-[11px] font-medium text-steel hover:bg-paper cursor-pointer disabled:opacity-50"
                          >
                            False Alarm
                          </button>
                          <button
                            type="button"
                            disabled={reviewLoading}
                            onClick={() => handleReviewSubmit('unresolved')}
                            className="border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-soft hover:bg-paper cursor-pointer disabled:opacity-50"
                          >
                            Pending
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
