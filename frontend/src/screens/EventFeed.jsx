import { useEffect, useState, useCallback, useMemo } from 'react'
import { listEvents, getEvent, submitReview } from '../api/events.js'
import { listVideos } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import { getScenarioConfig, getVideoScenarioInfo, resolveIncidentTitle } from '../lib/scenarios.js'
import {
  formatConfidence,
  formatScore,
  formatEntityName,
  humanizeExplanation,
} from '../lib/format.js'
import TemporalRiskPanel from '../components/TemporalRiskPanel.jsx'

const STATUS_STYLE = {
  supported: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  probable: 'border-amber-300 bg-amber-50 text-amber-800',
  insufficient_evidence: 'border-neutral-300 bg-neutral-100 text-neutral-600',
  unsupported: 'border-neutral-300 bg-neutral-100 text-neutral-500',
}

const STATUS_LABEL = {
  supported: 'Seen in video',
  probable: 'Probable',
  insufficient_evidence: 'Insufficient Evidence',
  unsupported: 'Unsupported',
}

const BAND_STYLE = {
  Critical: 'border-red-400 bg-red-50 text-red-800',
  High: 'border-orange-300 bg-orange-50 text-orange-800',
  Medium: 'border-amber-300 bg-amber-50 text-amber-800',
  Low: 'border-neutral-300 bg-neutral-100 text-neutral-700',
}

const REVIEW_BADGES = {
  confirmed_damage: {
    label: 'DAMAGE CONFIRMED',
    style: 'border-red-300 bg-red-50 text-red-800',
  },
  false_positive: {
    label: 'FALSE ALARM',
    style: 'border-sky-300 bg-sky-50 text-sky-800',
  },
  unresolved: {
    label: 'PENDING',
    style: 'border-amber-300 bg-amber-50 text-amber-800',
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
    return { label: cleanKey, text: value ? 'Yes' : 'No' }
  }
  if (typeof value === 'object' && value !== null) {
    return { label: cleanKey, text: JSON.stringify(value) }
  }
  return { label: cleanKey, text: String(value) }
}

export default function EventFeed() {
  const { navigateTo } = useLiveViewContext()
  const [events, setEvents] = useState([])
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const handleReplayIncident = (ev) => {
    if (!ev) return
    navigateTo('Incident Replay', {
      eventId: ev.event_id,
      videoId: ev.video_id,
      timestamp: ev.timestamp,
      event: ev,
    })
  }

  // Incident deduplication / clustering
  const [groupSimilar, setGroupSimilar] = useState(true)

  // Filters
  const [filterLens, setFilterLens] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterBand, setFilterBand] = useState('')
  const [filterVideo, setFilterVideo] = useState('')
  const [filterReviewState, setFilterReviewState] = useState('')
  const [order, setOrder] = useState('desc')
  const [offset, setOffset] = useState(0)
  const limit = 25

  // Selected event & detail
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)

  // Review submission state
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewMessage, setReviewMessage] = useState(null)
  const [showTechnical, setShowTechnical] = useState(false)

  // Group consecutive detections within 2 seconds of each other into distinct operational incidents
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

  // Load video list for filter dropdown
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

  // Fetch events list based on active filters
  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const filters = {
        limit,
        offset,
        order,
      }
      if (filterLens) filters.lens = filterLens
      if (filterStatus) filters.status = filterStatus
      if (filterBand) filters.band = filterBand
      if (filterVideo) filters.videoId = filterVideo

      if (filterReviewState === 'unreviewed') {
        filters.reviewed = false
      } else if (filterReviewState === 'reviewed') {
        filters.reviewed = true
      } else if (filterReviewState === 'confirmed_damage' || filterReviewState === 'false_positive' || filterReviewState === 'unresolved') {
        filters.reviewStatus = filterReviewState
      }

      const data = await listEvents(filters)
      setEvents(data)

      // Auto-select first event if none selected, or if current selectedEvent is not in the filtered list
      if (data.length > 0) {
        if (!selectedEventId || !data.some((ev) => ev.event_id === selectedEventId)) {
          setSelectedEventId(data[0].event_id)
        }
      } else {
        setSelectedEvent(null)
        setSelectedEventId(null)
      }
    } catch (err) {
      setError(err.message || 'Failed to load events from backend database.')
    } finally {
      setLoading(false)
    }
  }, [filterLens, filterStatus, filterBand, filterVideo, filterReviewState, order, offset, selectedEventId])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  // Load single event detail when selectedEventId changes
  useEffect(() => {
    if (!selectedEventId) {
      setSelectedEvent(null)
      return
    }
    let active = true
    setDetailLoading(true)
    setDetailError(null)
    setReviewMessage(null)

    getEvent(selectedEventId)
      .then((data) => {
        if (active) {
          setSelectedEvent(data)
        }
      })
      .catch((err) => {
        if (active) setDetailError(err.message || 'Failed to load event detail.')
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedEventId])

  // Handle Responsible AI Review submission
  const handleReviewSubmit = async (statusValue) => {
    if (!selectedEventId) return
    setReviewLoading(true)
    setReviewMessage(null)
    try {
      const updated = await submitReview(selectedEventId, statusValue, reviewNotes.trim() || null)
      setSelectedEvent(updated)
      setReviewMessage({
        type: 'success',
        text: `Review recorded: ${statusValue === 'confirmed_damage' ? 'Confirmed Damage' : statusValue === 'false_positive' ? 'False Alarm' : 'Pending'}`,
      })
      setReviewNotes('')

      // Update event in list locally so user immediately sees badge change
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

  // Helper to get clean video scenario info
  const getVideoInfo = (videoId) => {
    return getVideoScenarioInfo(videoId)
  }

  const getVideoName = (videoId) => {
    return getVideoScenarioInfo(videoId).cameraName
  }

  return (
    <div className="flex flex-col gap-6 text-ink max-w-7xl mx-auto w-full">
      {/* 1. Header: Primary Focus & Operational Subtitle */}
      <div className="border border-line bg-white p-5 shadow-xs flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-950">
              Safety Incidents
            </h1>
            <p className="text-xs text-neutral-600 mt-1">
              TRACE detects and explains safety risks from warehouse video.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="border border-line bg-paper px-2.5 py-1 text-neutral-700">
              Recorded: <strong className="font-bold font-mono tabular-nums text-neutral-950">{events.length}</strong>
            </span>
          </div>
        </div>

        {/* Recommended Demo Scenarios (One-Click Triage) */}
        <div className="border-t border-line pt-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          <span className="text-xs font-semibold text-neutral-700">
            ⭐ Recommended Demos:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedEventId(73)
                handleReplayIncident({ event_id: 73, video_id: 'ac99ff34e1bd2c13', timestamp: 36.67 })
              }}
              className="px-2.5 py-1 text-xs font-semibold bg-white border border-amber-300 text-amber-900 hover:bg-amber-50 shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>📦 Event #73</span>
              <span className="text-[11px] text-amber-700 font-normal">· Overhang &amp; What-If</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedEventId(75)
                handleReplayIncident({ event_id: 75, video_id: '93e4b1963c6fcd97', timestamp: 1.0 })
              }}
              className="px-2.5 py-1 text-xs font-semibold bg-white border border-emerald-300 text-emerald-900 hover:bg-emerald-50 shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>🛡️ Event #75</span>
              <span className="text-[11px] text-emerald-700 font-normal">· Verified Prevented</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedEventId(105)
                handleReplayIncident({ event_id: 105, video_id: '93e4b1963c6fcd97', timestamp: 0.0 })
              }}
              className="px-2.5 py-1 text-xs font-semibold bg-white border border-red-300 text-red-900 hover:bg-red-50 shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>⚠️ Event #105</span>
              <span className="text-[11px] text-red-700 font-normal">· Dock Edge Hazard</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Simplified Filters Toolbar */}
      <div className="border border-line bg-white p-3.5 shadow-xs flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 flex items-center gap-1.5">
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="bg-neutral-900 text-white text-[10px] font-mono tabular-nums px-1.5 py-0.2">
                {activeFilterCount}
              </span>
            )}
          </span>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-xs text-neutral-600 hover:text-neutral-900 underline font-medium cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
          {/* Risk Lens */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Risk Lens</label>
            <select
              value={filterLens}
              onChange={(e) => {
                setFilterLens(e.target.value)
                setOffset(0)
              }}
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500"
            >
              <option value="">All Lenses</option>
              <option value="structural">Structural</option>
              <option value="behaviour">Behaviour</option>
              <option value="conformance">Conformance</option>
              <option value="environmental">Environmental</option>
            </select>
          </div>

          {/* Evidence Status (formerly Epistemic Status) */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Evidence Status</label>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value)
                setOffset(0)
              }}
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500"
            >
              <option value="">All Statuses</option>
              <option value="supported">Seen in video</option>
              <option value="probable">Probable</option>
              <option value="insufficient_evidence">Insufficient Evidence</option>
              <option value="unsupported">Unsupported</option>
            </select>
          </div>

          {/* Risk Level */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Risk Level</label>
            <select
              value={filterBand}
              onChange={(e) => {
                setFilterBand(e.target.value)
                setOffset(0)
              }}
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500"
            >
              <option value="">All Levels</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          {/* Camera / Zone */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Camera / Zone</label>
            <select
              value={filterVideo}
              onChange={(e) => {
                setFilterVideo(e.target.value)
                setOffset(0)
              }}
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500 truncate"
            >
              <option value="">All Cameras</option>
              {videos.map((v) => {
                const info = getVideoScenarioInfo(v.id || v.filename)
                return (
                  <option key={v.id} value={v.id}>
                    {info.cameraName} ({info.scenarioTitle})
                  </option>
                )
              })}
            </select>
          </div>

          {/* Review State */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Review State</label>
            <select
              value={filterReviewState}
              onChange={(e) => {
                setFilterReviewState(e.target.value)
                setOffset(0)
              }}
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500"
            >
              <option value="">All Reviews</option>
              <option value="unreviewed">Unreviewed Only</option>
              <option value="reviewed">Reviewed Only</option>
              <option value="confirmed_damage">Confirmed Damage</option>
              <option value="false_positive">False Alarm</option>
              <option value="unresolved">Pending</option>
            </select>
          </div>

          {/* Sort Order */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Sort Order</label>
            <select
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500"
            >
              <option value="desc">Newest Recorded</option>
              <option value="asc">Chronological</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. Main Workspace: Primary Recorded Incident List & Incident Evidence Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Recorded Incidents (Primary Focus, 7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-800">
                Recorded Incidents ({displayedEvents.length})
              </h2>
              <button
                type="button"
                onClick={() => setGroupSimilar(!groupSimilar)}
                className={`text-[10px] font-semibold px-2 py-0.5 border cursor-pointer transition-colors ${
                  groupSimilar
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                }`}
                title="Group repeated frame detections within 2 seconds into distinct incidents"
              >
                {groupSimilar ? 'Grouped Incidents' : 'All Detections'}
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="border border-line bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium cursor-pointer"
              >
                Previous
              </button>
              <span className="text-[11px] text-neutral-500 font-mono tabular-nums">
                {offset}–{offset + events.length}
              </span>
              <button
                type="button"
                disabled={events.length < limit || loading}
                onClick={() => setOffset(offset + limit)}
                className="border border-line bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="border border-line bg-white p-8 text-center flex flex-col items-center gap-2">
              <div className="w-5 h-5 border-2 border-neutral-900 border-t-transparent animate-spin" />
              <span className="text-xs text-neutral-600">
                Loading incidents from database...
              </span>
            </div>
          )}

          {/* Error State */}
          {!loading && error && (
            <div className="border border-red-300 bg-red-50 p-4 text-xs text-red-800 flex flex-col gap-2">
              <div className="font-bold flex items-center gap-1.5">
                <span>Failed to load incidents</span>
              </div>
              <p className="font-mono text-[11px]">{error}</p>
              <button
                type="button"
                onClick={fetchEvents}
                className="self-start border border-red-400 bg-white px-3 py-1 text-xs font-semibold hover:bg-red-100 cursor-pointer"
              >
                Retry Request
              </button>
            </div>
          )}

          {/* Empty Results State */}
          {!loading && !error && events.length === 0 && (
            <div className="border border-line bg-white p-8 text-center flex flex-col items-center gap-3">
              <span className="text-sm font-bold text-neutral-800">
                {activeFilterCount > 0 ? 'No Matching Incidents Found' : 'No Recorded Incidents in Database'}
              </span>
              <p className="text-xs text-neutral-600 max-w-md leading-relaxed">
                {activeFilterCount > 0
                  ? 'No recorded events match the selected filters. Try clearing or adjusting filters.'
                  : 'Incidents are automatically detected and saved when warehouse video streams are monitored.'}
              </p>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="border border-neutral-800 bg-neutral-900 text-white px-3 py-1 text-xs font-semibold hover:bg-neutral-800 cursor-pointer"
                >
                  Clear Filters
                </button>
              )}
            </div>
          )}

          {/* Scannable Incident Cards */}
          {!loading && !error && displayedEvents.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {displayedEvents.map((ev) => {
                const isSelected = ev.event_id === selectedEventId
                const config = getScenarioConfig(ev.scenario)
                const title = resolveIncidentTitle(ev) || config.title || 'Recorded Safety Hazard'
                const explanationText = humanizeExplanation(
                  ev.explanation || ev.planner_recommendation?.rationale || config.whyItMatters || 'Uncorrected handling hazards directly escalate risk to personnel safety and product integrity.',
                  ev.scenario,
                  ev.entity_id
                )
                const action = ev.planner_recommendation?.action || ev.recommended_action || config.recommendedAction
                const bandCls = ev.band ? (BAND_STYLE[ev.band] || BAND_STYLE.Low) : null
                const reviewBadge = ev.reviewed && ev.review_status ? REVIEW_BADGES[ev.review_status] : null
                const videoInfo = getVideoInfo(ev.video_id)

                return (
                  <div
                    key={ev.event_id}
                    onClick={() => setSelectedEventId(ev.event_id)}
                    className={`border bg-white p-4 transition-all flex flex-col gap-2.5 cursor-pointer text-left ${
                      isSelected
                        ? 'border-neutral-900 ring-1 ring-neutral-900 bg-neutral-50/70 shadow-xs'
                        : 'border-line hover:border-neutral-400'
                    }`}
                  >
                    {/* 1. Header: [CRITICAL] Title */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${bandCls || 'border-neutral-300 bg-neutral-100 text-neutral-700'}`}>
                          {ev.band ? ev.band.toUpperCase() : 'INCIDENT'}
                        </span>
                        <h3 className="text-sm font-bold text-neutral-950">
                          {title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs">
                        {ev.event_type === 'prevented' && (
                          <span className="border border-emerald-500 bg-emerald-50 text-emerald-800 px-1.5 py-0.2 text-[9px] uppercase font-bold">
                            PREVENTED
                          </span>
                        )}
                        {ev.event_type === 'near_miss' && (
                          <span className="border border-amber-500 bg-amber-50 text-amber-800 px-1.5 py-0.2 text-[9px] uppercase font-bold">
                            NEAR-MISS
                          </span>
                        )}
                        {reviewBadge && (
                          <span className={`border px-1.5 py-0.2 text-[9px] font-bold ${reviewBadge.style}`}>
                            {reviewBadge.label}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 2. Location · Timestamp */}
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500 font-medium">
                      <span>{videoInfo.cameraName}</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums font-bold text-neutral-800">{formatTimestamp(ev.timestamp)}</span>
                      {ev._clusterCount > 1 && (
                        <>
                          <span>·</span>
                          <span className="text-[11px] text-neutral-500 font-mono">
                            {ev._clusterCount} detections
                          </span>
                        </>
                      )}
                    </div>

                    {/* 3. WHY IT MATTERS */}
                    <div className="text-xs text-neutral-700 leading-relaxed">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-0.5">
                        WHY IT MATTERS:
                      </span>
                      <p>{explanationText}</p>
                    </div>

                    {/* 4. ACTION */}
                    {action && (
                      <div className="text-xs text-emerald-950 bg-emerald-50/60 border border-emerald-200/80 p-2.5 leading-relaxed">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block mb-0.5">
                          ACTION:
                        </span>
                        <p className="font-semibold">{action}</p>
                      </div>
                    )}

                    {/* 5. Bottom row: View evidence & Replay */}
                    <div className="flex items-center justify-between border-t border-line/60 pt-2 mt-0.5 text-xs">
                      <span className="text-[11px] text-neutral-500">
                        {videoInfo.scenarioTitle}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-semibold flex items-center gap-1 transition-colors ${
                            isSelected
                              ? 'text-neutral-950 font-bold underline'
                              : 'text-neutral-600 hover:text-neutral-950'
                          }`}
                        >
                          <span>View evidence</span>
                          <span>→</span>
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleReplayIncident(ev)
                          }}
                          className="border border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 px-2.5 py-1 text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                          title="Replay incident footage"
                        >
                          <span>Replay</span>
                          <span className="text-[10px]">▶</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right Column: Incident Evidence (Investigation Drawer, 5 cols) */}
        <div className="lg:col-span-5 sticky top-6">
          <div className="border border-line bg-white shadow-xs flex flex-col">
            <div className="border-b border-line p-3.5 bg-neutral-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-800">
                  Incident Evidence
                </span>
              </div>
              {selectedEvent && (
                <span className="font-mono text-[11px] text-neutral-500">
                  #{selectedEvent.event_id}
                </span>
              )}
            </div>

            {/* Detail Loading State */}
            {detailLoading && (
              <div className="p-8 text-center flex flex-col items-center gap-2">
                <div className="w-4 h-4 border-2 border-neutral-900 border-t-transparent animate-spin" />
                <span className="text-xs text-neutral-600">
                  Loading incident #{selectedEventId}...
                </span>
              </div>
            )}

            {/* Detail Error State */}
            {!detailLoading && detailError && (
              <div className="p-4 text-xs text-red-800 bg-red-50 border-b border-red-200 flex flex-col gap-2">
                <span className="font-bold">Failed to load incident details</span>
                <p className="font-mono text-[11px]">{detailError}</p>
              </div>
            )}

            {/* No Event Selected State */}
            {!detailLoading && !detailError && !selectedEvent && (
              <div className="p-8 text-center text-xs text-neutral-500 flex flex-col items-center gap-2">
                <span>Select an incident from the list to inspect video evidence and action guidance.</span>
              </div>
            )}

            {/* Selected Event Details: Clean Investigation Drawer */}
            {!detailLoading && !detailError && selectedEvent && (
              <div className="p-4 flex flex-col gap-4 text-xs">
                {/* 1. Video / Replay Context Hero */}
                <div className="bg-neutral-900 text-white p-3.5 border border-neutral-800 flex items-center justify-between gap-3 shadow-2xs">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      Video Evidence Clip
                    </span>
                    <span className="text-xs font-bold text-white">
                      {getVideoName(selectedEvent.video_id)}
                    </span>
                    <span className="text-[11px] text-neutral-300 font-mono">
                      Timestamp: <strong className="text-white">{formatTimestamp(selectedEvent.timestamp)}</strong> ({typeof selectedEvent.timestamp === 'number' ? selectedEvent.timestamp.toFixed(1) : selectedEvent.timestamp}s)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleReplayIncident(selectedEvent)}
                    className="bg-white text-neutral-950 hover:bg-neutral-100 font-bold px-3 py-1.5 text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer shrink-0"
                  >
                    <span>Replay</span>
                    <span className="text-[10px]">▶</span>
                  </button>
                </div>

                {/* 2. Incident Heading & Location */}
                <div className="flex flex-col gap-1 pb-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BAND_STYLE[selectedEvent.band] || BAND_STYLE.Low}`}>
                      {selectedEvent.band ? `${selectedEvent.band.toUpperCase()} RISK` : 'INCIDENT'}
                    </span>
                    <span className="border border-line bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-neutral-700">
                      {selectedEvent.lens}
                    </span>
                    {selectedEvent.event_type === 'prevented' && (
                      <span className="border border-emerald-500 bg-emerald-50 text-emerald-800 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                        PREVENTED
                      </span>
                    )}
                    {selectedEvent.event_type === 'near_miss' && (
                      <span className="border border-amber-500 bg-amber-50 text-amber-800 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                        NEAR-MISS
                      </span>
                    )}
                  </div>
                  <h2 className="text-base font-bold text-neutral-950 leading-snug mt-1">
                    {resolveIncidentTitle(selectedEvent)}
                  </h2>
                  <div className="text-xs text-neutral-500 font-medium">
                    {getVideoName(selectedEvent.video_id)} · <span className="font-mono font-bold text-neutral-700">{formatTimestamp(selectedEvent.timestamp)}</span>
                  </div>
                </div>

                {/* 3. WHAT WAS DETECTED */}
                <div className="flex flex-col gap-1 border-t border-line pt-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    WHAT WAS DETECTED
                  </span>
                  <p className="text-xs text-neutral-800 leading-relaxed font-sans bg-neutral-50 p-2.5 border border-line">
                    {humanizeExplanation(selectedEvent.explanation, selectedEvent.scenario, selectedEvent.entity_id)}
                  </p>
                </div>

                {/* 4. WHY IT MATTERS */}
                <div className="flex flex-col gap-1 border-t border-line pt-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
                    WHY IT MATTERS
                  </span>
                  <p className="text-xs text-neutral-800 leading-relaxed font-sans bg-amber-50/40 p-2.5 border border-amber-200/60">
                    {selectedEvent.planner_recommendation?.rationale || getScenarioConfig(selectedEvent.scenario).whyItMatters || 'Uncorrected handling hazards directly escalate risk to personnel safety and product integrity.'}
                  </p>
                </div>

                {/* 5. RECOMMENDED ACTION */}
                <div className="flex flex-col gap-1 border-t border-line pt-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 flex items-center justify-between">
                    <span>RECOMMENDED ACTION</span>
                    {selectedEvent.planner_recommendation?.what_if_eligible && (
                      <span className="border border-emerald-300 bg-emerald-50 text-emerald-800 text-[9px] px-1.5 py-0.2 font-semibold">
                        WHAT-IF TESTABLE
                      </span>
                    )}
                  </span>
                  <div className="border border-emerald-300 bg-emerald-50/70 p-3 text-xs text-emerald-950 flex flex-col gap-1.5">
                    <span className="font-bold leading-relaxed">
                      {selectedEvent.planner_recommendation?.action || selectedEvent.recommended_action || getScenarioConfig(selectedEvent.scenario).recommendedAction}
                    </span>
                  </div>
                </div>

                {/* 6. Primary Replay Action Button */}
                <div className="border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => handleReplayIncident(selectedEvent)}
                    className="w-full border border-neutral-900 bg-neutral-900 hover:bg-neutral-800 text-white font-bold py-2.5 px-3 text-xs flex items-center justify-center gap-2 shadow-2xs transition-colors cursor-pointer"
                  >
                    <span>Replay Incident Footage</span>
                    <span className="text-xs">▶</span>
                  </button>
                </div>

                {/* 7. Operator Review */}
                <div className="border-t border-line pt-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                      Operator Review
                    </span>
                    {selectedEvent.reviewed && selectedEvent.review_status ? (
                      <span className={`border px-1.5 py-0.2 text-[9px] font-bold ${REVIEW_BADGES[selectedEvent.review_status]?.style}`}>
                        {REVIEW_BADGES[selectedEvent.review_status]?.label}
                      </span>
                    ) : (
                      <span className="text-[10px] text-neutral-400">Unreviewed</span>
                    )}
                  </div>

                  {reviewMessage && (
                    <div
                      className={`p-2 text-xs border ${
                        reviewMessage.type === 'success'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-red-300 bg-red-50 text-red-800'
                      }`}
                    >
                      {reviewMessage.text}
                    </div>
                  )}

                  <input
                    type="text"
                    placeholder="Review note (optional)..."
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="border border-line bg-white px-2 py-1 text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-neutral-500 w-full"
                  />

                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('confirmed_damage')}
                      className="border border-red-300 bg-white hover:bg-red-50 text-red-800 py-1 text-[10px] font-bold uppercase disabled:opacity-50 cursor-pointer"
                    >
                      Damage
                    </button>
                    <button
                      type="button"
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('false_positive')}
                      className="border border-sky-300 bg-white hover:bg-sky-50 text-sky-800 py-1 text-[10px] font-bold uppercase disabled:opacity-50 cursor-pointer"
                    >
                      False Alarm
                    </button>
                    <button
                      type="button"
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('unresolved')}
                      className="border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 py-1 text-[10px] font-bold uppercase disabled:opacity-50 cursor-pointer"
                    >
                      Pending
                    </button>
                  </div>
                </div>

                {/* 8. Collapsible Technical Details */}
                <div className="border-t border-line pt-2">
                  <button
                    type="button"
                    onClick={() => setShowTechnical(!showTechnical)}
                    className="text-[11px] text-neutral-600 hover:text-neutral-900 font-medium flex items-center justify-between w-full py-1 cursor-pointer"
                  >
                    <span>Technical details</span>
                    <span className="font-mono text-[10px]">{showTechnical ? '▲' : '▾'}</span>
                  </button>

                  {showTechnical && (
                    <div className="mt-2 flex flex-col gap-2.5 bg-neutral-50 p-3 border border-line text-[11px]">
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div><span className="text-neutral-500">Event ID:</span> <span className="font-mono font-bold text-neutral-800">#{selectedEvent.event_id}</span></div>
                        <div><span className="text-neutral-500">Evidence Status:</span> <span className="font-bold text-neutral-800">{STATUS_LABEL[selectedEvent.status] || selectedEvent.status}</span></div>
                        <div><span className="text-neutral-500">Entity:</span> <span className="font-bold text-neutral-800">{formatEntityName(selectedEvent.entity_id) || 'Global scene'}</span></div>
                        <div><span className="text-neutral-500">Confidence:</span> <span className="font-mono font-bold text-neutral-800">{formatConfidence(selectedEvent.confidence)}</span></div>
                        <div><span className="text-neutral-500">Risk Score:</span> <span className="font-mono font-bold text-neutral-800">{formatScore(selectedEvent.risk_score)}</span></div>
                        <div><span className="text-neutral-500">Internal Scenario:</span> <span className="font-mono text-neutral-700">{selectedEvent.scenario}</span></div>
                      </div>

                      {/* Video Evidence Measurements */}
                      {selectedEvent.evidence && Object.keys(selectedEvent.evidence).length > 0 && (
                        <div className="flex flex-col gap-1 border-t border-line/60 pt-2">
                          <span className="font-bold text-neutral-600 uppercase text-[9px]">
                            Video Evidence Measurements
                          </span>
                          <div className="flex flex-col gap-1 font-mono text-[10px] bg-white p-2 border border-line">
                            {Object.entries(selectedEvent.evidence).map(([k, v]) => {
                              const item = formatEvidenceItem(k, v)
                              return (
                                <div key={k} className="flex items-baseline justify-between gap-2 border-b border-line/40 pb-0.5 last:border-b-0">
                                  <span className="text-neutral-500 capitalize font-sans">{item.label}:</span>
                                  <span className="text-neutral-900 font-semibold">{item.text}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Sensor & Camera Limitations */}
                      {selectedEvent.limitations && selectedEvent.limitations.length > 0 && (
                        <div className="flex flex-col gap-1 border-t border-line/60 pt-2">
                          <span className="font-bold text-neutral-600 uppercase text-[9px]">
                            Sensor Limitations
                          </span>
                          <ul className="list-disc list-inside text-neutral-600 text-[10px]">
                            {selectedEvent.limitations.map((lim, idx) => (
                              <li key={idx}>{lim.replace(/_/g, ' ')}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="text-[9px] font-mono text-neutral-400 border-t border-line/60 pt-1">
                        Clip: {selectedEvent.clip_path || 'Standard challenge stream'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. Tertiary Layer: Temporal Reasoning & Predictive Risk Engine (Below Incidents) */}
      <TemporalRiskPanel
        videoId={filterVideo || null}
        lens={filterLens || null}
        scenario={null}
        onSelectEvent={(eid) => {
          setSelectedEventId(eid)
        }}
      />
    </div>
  )
}