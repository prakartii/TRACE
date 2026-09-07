import { useEffect, useState, useCallback, useMemo } from 'react'
import { listEvents, getEvent, submitReview } from '../api/events.js'
import { listVideos } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import { getScenarioConfig, getVideoScenarioInfo, resolveIncidentTitle } from '../lib/scenarios.js'
import {
  formatConfidence,
  formatScore,
  formatPercentage,
  formatEntityName,
  humanizeExplanation,
} from '../lib/format.js'

const STATUS_STYLE = {
  supported: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  probable: 'border-amber-300 bg-amber-50 text-amber-800',
  insufficient_evidence: 'border-neutral-300 bg-neutral-100 text-neutral-600',
  unsupported: 'border-neutral-300 bg-neutral-100 text-neutral-500',
}

const STATUS_LABEL = {
  supported: 'SUPPORTED FINDING',
  probable: 'PROBABLE FINDING',
  insufficient_evidence: 'INSUFFICIENT EVIDENCE',
  unsupported: 'UNSUPPORTED SCENARIO',
}

const BAND_STYLE = {
  Critical: 'border-red-400 bg-red-50 text-red-800',
  High: 'border-orange-300 bg-orange-50 text-orange-800',
  Medium: 'border-amber-300 bg-amber-50 text-amber-800',
  Low: 'border-neutral-300 bg-neutral-50 text-neutral-700',
}

const REVIEW_BADGES = {
  confirmed_damage: {
    label: 'CONFIRMED DAMAGE',
    style: 'border-red-400 bg-red-50 text-red-800 font-bold',
  },
  false_positive: {
    label: 'FALSE POSITIVE',
    style: 'border-sky-400 bg-sky-50 text-sky-800 font-bold',
  },
  unresolved: {
    label: 'UNRESOLVED / PENDING',
    style: 'border-amber-400 bg-amber-50 text-amber-800 font-bold',
  },
}

const SCENARIO_TITLES = {
  stepping_on_carton: 'Worker body weight applied to carton surface',
  stepping_on_carton_precursor: 'Worker ascending onto carton base',
  box_overhang: 'Unstable carton overhang beyond supporting base',
  pallet_overhang: 'Pallet edge overhang beyond rack/floor support',
  heavy_on_light_stacking: 'Heavy carton placed above lightweight base carton',
  unsupported_bending_placement: 'Unsupported carton overhang with structural bending',
  dropping_or_throwing_precursor: 'Kinematic acceleration spike indicating drop or throw',
  carton_drop: 'Carton freefall impact / drop detected',
  dragging_precursor: 'Carton dragged along floor surface rather than lifted',
  rolling_precursor: 'Carton rolled or rotated end-over-end',
  straps_as_handles: 'Packaging straps used as lifting handles',
  wrong_product_orientation: 'Non-compliant package orientation against SKU manifest',
  max_stack_height_exceeded: 'Stack height exceeds product threshold',
  entity_in_dock_edge_zone: 'Fall hazard: entity positioned within dock ledge boundary',
  entity_in_wet_floor_zone: 'Slip/impact hazard: handling in marked wet floor zone',
  box_displacement_near_person: 'Moving cargo in close proximity to worker',
  person_box_sustained_proximity: 'Worker in sustained close proximity to cargo',
  solo_heavy_handling: 'Ergonomic lift hazard: heavy SKU handled by single worker',
  image_space_support_hypothesis: 'Image-space support alignment hypothesis',
  unplanned_loading_sequence: 'Loading sequence deviates from optimal manifest',
  wrong_equipment_usage: 'Unapproved handling equipment used for SKU class',
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

      // Auto-select first event if none selected and results exist
      if (data.length > 0 && !selectedEventId) {
        setSelectedEventId(data[0].event_id)
      } else if (data.length === 0) {
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
        text: `Review recorded as: ${statusValue.replace(/_/g, ' ').toUpperCase()}`,
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
    <div className="flex flex-col gap-6 text-ink">
      {/* 1. Header Banner & Operational Mental Model */}
      <div className="border border-line bg-white p-6 shadow-sm flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold tracking-tight text-neutral-900">
                Safety Incidents
              </h1>
              <span className="border border-line bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                Safety Incident Inbox
              </span>
            </div>
            <p className="text-xs text-neutral-600 max-w-2xl leading-relaxed">
              Detected safety events from monitored warehouse video.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="border border-line bg-paper px-2.5 py-1 text-neutral-700">
              Loaded Events: <strong className="font-bold font-mono tabular-nums text-neutral-950">{events.length}</strong>
            </span>
          </div>
        </div>

        {/* 5-Step Operational Triage Trace Banner */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 border-t border-line pt-3 mt-1 text-xs">
          <div className="flex flex-col gap-0.5 border-l-2 border-neutral-300 pl-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">1. WHAT IS HAPPENING?</span>
            <span className="text-[11px] text-neutral-800 font-medium">OBSERVED Scenario</span>
          </div>
          <div className="flex flex-col gap-0.5 border-l-2 border-neutral-300 pl-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">2. WHERE / WHEN?</span>
            <span className="text-[11px] text-neutral-800 font-medium">Video & Timestamp</span>
          </div>
          <div className="flex flex-col gap-0.5 border-l-2 border-neutral-300 pl-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">3. CERTAINTY</span>
            <span className="text-[11px] text-neutral-800 font-medium">Epistemic Status</span>
          </div>
          <div className="flex flex-col gap-0.5 border-l-2 border-neutral-300 pl-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">4. WHAT WILL HAPPEN?</span>
            <span className="text-[11px] text-neutral-800 font-medium">Risk Band & Score</span>
          </div>
          <div className="flex flex-col gap-0.5 border-l-2 border-emerald-500 pl-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">5. WHAT TO DO NOW?</span>
            <span className="text-[11px] text-emerald-900 font-semibold">Safe Intervention</span>
          </div>
        </div>
      </div>

      {/* Recommended Demo Scenarios (Judge Quick-Select) */}
      <div className="border border-neutral-300 bg-neutral-50/90 p-3.5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-800">
            ⭐ Recommended Demos (One-Click Triage):
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSelectedEventId(73)
              handleReplayIncident({ event_id: 73, video_id: 'ac99ff34e1bd2c13', timestamp: 36.67 })
            }}
            className="px-2.5 py-1 text-[11px] font-bold bg-white border border-amber-400 text-amber-900 hover:bg-amber-50 shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>📦 <span className="font-mono">Event #73</span></span>
            <span className="text-[10px] text-amber-700 font-normal">Overhang + What-If</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedEventId(75)
              handleReplayIncident({ event_id: 75, video_id: '93e4b1963c6fcd97', timestamp: 1.0 })
            }}
            className="px-2.5 py-1 text-[11px] font-bold bg-white border border-emerald-400 text-emerald-900 hover:bg-emerald-50 shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>🛡️ <span className="font-mono">Event #75</span></span>
            <span className="text-[10px] text-emerald-700 font-normal">Verified Prevented</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedEventId(105)
              handleReplayIncident({ event_id: 105, video_id: '93e4b1963c6fcd97', timestamp: 0.0 })
            }}
            className="px-2.5 py-1 text-[11px] font-bold bg-white border border-red-400 text-red-900 hover:bg-red-50 shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>⚠️ <span className="font-mono">Event #105</span></span>
            <span className="text-[10px] text-red-700 font-normal">Dock Edge Hazard</span>
          </button>
        </div>
      </div>

      {/* 2. Structured Filters Toolbar */}
      <div className="border border-line bg-white p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 flex items-center gap-1.5">
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="bg-neutral-900 text-white text-[10px] font-mono tabular-nums px-1.5 py-0.2 rounded-full">
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
              Reset All Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5 text-xs">
          {/* Lens Filter */}
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

          {/* Status Filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Epistemic Status</label>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value)
                setOffset(0)
              }}
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500"
            >
              <option value="">All Statuses</option>
              <option value="supported">Supported</option>
              <option value="probable">Probable</option>
              <option value="insufficient_evidence">Insufficient Evidence</option>
              <option value="unsupported">Unsupported</option>
            </select>
          </div>

          {/* Risk Band Filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Risk Band</label>
            <select
              value={filterBand}
              onChange={(e) => {
                setFilterBand(e.target.value)
                setOffset(0)
              }}
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500"
            >
              <option value="">All Bands</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          {/* Camera / Zone Filter */}
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
              <option value="">All Camera Zones</option>
              {videos.map((v) => {
                const info = getVideoScenarioInfo(v.id || v.filename)
                return (
                  <option key={v.id} value={v.id}>
                    {info.scenarioTitle} — {info.cameraName}
                  </option>
                )
              })}
            </select>
          </div>

          {/* Review Status Filter */}
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
              <option value="false_positive">False Positive</option>
              <option value="unresolved">Unresolved / Pending</option>
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

      {/* 3. Main Workspace: Feed List & Event Detail Surface */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Events Feed (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                Recorded Incident List ({displayedEvents.length})
              </span>
              <button
                type="button"
                onClick={() => setGroupSimilar(!groupSimilar)}
                className={`text-[10px] font-bold px-2 py-0.5 border cursor-pointer transition-colors ${
                  groupSimilar
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                }`}
                title="Group repeated frame detections within 2 seconds into distinct incidents"
              >
                {groupSimilar ? '✓ Grouped Incidents' : 'Raw Detections'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="border border-line bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium cursor-pointer"
              >
                Previous
              </button>
              <span className="text-[11px] text-neutral-500">
                Offset: <span className="font-mono tabular-nums">{offset}</span>
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
              <div className="w-5 h-5 border-2 border-neutral-800 border-t-transparent animate-spin" />
              <span className="text-xs text-neutral-600">
                Loading operational events from SQLite store...
              </span>
            </div>
          )}

          {/* Error State */}
          {!loading && error && (
            <div className="border border-red-300 bg-red-50 p-4 text-xs text-red-800 flex flex-col gap-2">
              <div className="font-bold flex items-center gap-1.5">
                <span>[ERROR] Failed to query events</span>
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
                {activeFilterCount > 0 ? 'No Matching Events Found' : 'No Recorded Events in Database'}
              </span>
              <p className="text-xs text-neutral-600 max-w-md leading-relaxed">
                {activeFilterCount > 0
                  ? 'No persisted events match the current filter criteria. Try adjusting your filter settings.'
                  : 'Events are automatically persisted when challenge videos are monitored in Live View. Load a video in Live View to populate the audit ledger.'}
              </p>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="border border-neutral-800 bg-neutral-900 text-white px-3 py-1 text-xs font-semibold hover:bg-neutral-800 cursor-pointer"
                >
                  Clear Active Filters
                </button>
              )}
            </div>
          )}

          {/* Feed List Items */}
          {!loading && !error && displayedEvents.length > 0 && (
            <div className="flex flex-col gap-2">
              {displayedEvents.map((ev) => {
                const isSelected = ev.event_id === selectedEventId
                const config = getScenarioConfig(ev.scenario)
                const title = resolveIncidentTitle(ev) || config.title || 'Observed Condition'
                const entityName = formatEntityName(ev.entity_id)
                const explanationText = humanizeExplanation(
                  ev.explanation || ev.planner_recommendation?.rationale || config.whyItMatters || 'Insufficient support increases tipping and stack instability risk.',
                  ev.scenario,
                  ev.entity_id
                )
                const statusCls = STATUS_STYLE[ev.status] || STATUS_STYLE.insufficient_evidence
                const bandCls = ev.band ? (BAND_STYLE[ev.band] || BAND_STYLE.Low) : null
                const reviewBadge = ev.reviewed && ev.review_status ? REVIEW_BADGES[ev.review_status] : null

                const videoInfo = getVideoInfo(ev.video_id)

                return (
                  <button
                    key={ev.event_id}
                    onClick={() => setSelectedEventId(ev.event_id)}
                    className={`w-full text-left border bg-white p-3.5 transition-all flex flex-col gap-2.5 ${
                      isSelected
                        ? 'border-neutral-900 ring-1 ring-neutral-900 bg-neutral-50/60 shadow-sm'
                        : 'border-line hover:border-neutral-400'
                    }`}
                  >
                    {/* Top Row: Severity Badge, Camera Location, Timestamp, Status */}
                    <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                      <div className="flex items-center gap-2">
                        {bandCls && (
                          <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${bandCls}`}>
                            {ev.band} Risk
                          </span>
                        )}
                        <span className="text-[11px] text-neutral-600 font-medium">
                          {videoInfo.cameraName}
                        </span>
                        <span className="font-mono text-xs font-bold text-neutral-900 tabular-nums">
                          {formatTimestamp(ev.timestamp)}
                        </span>
                        {ev._clusterCount > 1 && (
                          <span className="border border-blue-300 bg-blue-50 text-blue-800 text-[10px] font-bold uppercase px-1.5 py-0.2">
                            {ev._clusterCount} Detections ({formatTimestamp(ev._minTimestamp)} – {formatTimestamp(ev._maxTimestamp)})
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className={`border px-1.5 py-0.2 text-[10px] font-bold tracking-wide ${statusCls}`}>
                          {STATUS_LABEL[ev.status] || ev.status?.toUpperCase()}
                        </span>
                        {ev.event_type === 'prevented' && (
                          <span className="border border-emerald-500 bg-emerald-50 text-emerald-800 px-1.5 py-0.2 text-[9px] uppercase tracking-wider font-bold">
                            PREVENTED
                          </span>
                        )}
                        {ev.event_type === 'near_miss' && (
                          <span className="border border-amber-500 bg-amber-50 text-amber-800 px-1.5 py-0.2 text-[9px] uppercase tracking-wider font-bold">
                            NEAR-MISS
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle Row: Plain-English Incident Title & Explanation */}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-neutral-950 leading-snug">
                          "{title}"
                        </h3>
                        {entityName && (
                          <span className="text-[10px] text-neutral-500 font-mono">
                            Target: <strong className="text-neutral-700">{entityName}</strong>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-700 leading-relaxed font-sans">
                        <strong>Why it matters:</strong> {explanationText}
                      </p>
                    </div>

                    {/* Recommended Action Card */}
                    {(ev.planner_recommendation?.action || ev.recommended_action || config.recommendedAction) && (
                      <div className="border-l-2 border-emerald-500 bg-emerald-50/50 p-2 text-xs text-emerald-950">
                        <strong className="text-emerald-900 text-[10px] uppercase block mb-0.5 font-bold">Recommended Action:</strong>
                        {ev.planner_recommendation?.action || ev.recommended_action || config.recommendedAction}
                      </div>
                    )}

                    {/* Bottom Action Row: Scenario Title & View Incident CTA */}
                    <div className="flex items-center justify-between border-t border-line/60 pt-2 mt-0.5 text-xs">
                      <span className="text-[10px] text-neutral-500 font-medium">
                        {videoInfo.scenarioTitle}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleReplayIncident(ev)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation()
                            handleReplayIncident(ev)
                          }
                        }}
                        className="border border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 px-3 py-1 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                        title={`View incident in replay context`}
                      >
                        <span>View Incident</span>
                        <span>→</span>
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right Column: Event Detail & Responsible AI Review Surface (5 cols) */}
        <div className="lg:col-span-5 sticky top-6">
          <div className="border border-line bg-white shadow-sm flex flex-col">
            <div className="border-b border-line p-3.5 bg-neutral-50 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-800">
                Recorded Event Detail
              </span>
              {selectedEvent && (
                <span className="font-mono text-[11px] text-neutral-600">
                  ID: #{selectedEvent.event_id}
                </span>
              )}
            </div>

            {/* Detail Loading State */}
            {detailLoading && (
              <div className="p-8 text-center flex flex-col items-center gap-2">
                <div className="w-4 h-4 border-2 border-neutral-800 border-t-transparent animate-spin" />
                <span className="text-xs text-neutral-600">
                  Retrieving event #{selectedEventId}...
                </span>
              </div>
            )}

            {/* Detail Error State */}
            {!detailLoading && detailError && (
              <div className="p-4 text-xs text-red-800 bg-red-50 border-b border-red-200 flex flex-col gap-2">
                <span className="font-bold">[ERROR] Failed to load event details</span>
                <p className="font-mono text-[11px]">{detailError}</p>
              </div>
            )}

            {/* No Event Selected State */}
            {!detailLoading && !detailError && !selectedEvent && (
              <div className="p-8 text-center text-xs text-neutral-500 flex flex-col items-center gap-2">
                <span>Select an event from the feed to inspect recorded evidence and planner recommendations.</span>
              </div>
            )}

            {/* Selected Event Details */}
            {!detailLoading && !detailError && selectedEvent && (
              <div className="p-4 flex flex-col gap-4 text-xs">
                {/* Archived Warning Callout */}
                <div className="border-l-2 border-neutral-400 bg-neutral-100 p-2 text-[11px] text-neutral-700 leading-relaxed">
                  <strong>ARCHIVED RECORD:</strong> This finding and recommendation were preserved at snapshot timestamp <span className="font-mono">{formatTimestamp(selectedEvent.timestamp)}</span>.
                </div>

                {/* Primary Action Banner: Replay incident */}
                <div className="flex items-center justify-between bg-neutral-900 text-white p-3 shadow-xs border border-neutral-800">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-400">
                      Investigate in Video Context
                    </span>
                    <span className="text-xs font-bold text-white">
                      {selectedEvent.video_id ? getVideoName(selectedEvent.video_id) : 'Source Video'} @ <span className="font-mono">{formatTimestamp(selectedEvent.timestamp)}</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleReplayIncident(selectedEvent)}
                    className="bg-white text-neutral-950 hover:bg-neutral-100 font-bold px-3 py-1.5 text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  >
                    <span>Replay incident</span>
                    <span className="text-[10px]">▶</span>
                  </button>
                </div>

                {/* Event Identification */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${STATUS_STYLE[selectedEvent.status] || STATUS_STYLE.insufficient_evidence}`}>
                      {STATUS_LABEL[selectedEvent.status] || selectedEvent.status?.toUpperCase()}
                    </span>
                    <span className="border border-line bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-neutral-700">
                      {selectedEvent.lens}
                    </span>
                    {selectedEvent.confidence && (
                      <span className="text-[10px] text-neutral-600">
                        CONF: <span className="font-mono tabular-nums">{formatConfidence(selectedEvent.confidence)}</span>
                      </span>
                    )}
                    {selectedEvent.band && (
                      <span className={`border px-1.5 py-0.5 text-[10px] font-bold uppercase ${BAND_STYLE[selectedEvent.band] || BAND_STYLE.Low}`}>
                        {selectedEvent.band} Risk
                      </span>
                    )}
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

                  <h2 className="text-sm font-bold text-neutral-900 leading-snug">
                    {resolveIncidentTitle(selectedEvent)}
                  </h2>

                  <div className="text-[11px] text-neutral-600 flex flex-col gap-0.5 border-t border-line pt-2">
                    <div>Video: <span className="text-neutral-900 font-semibold">{getVideoName(selectedEvent.video_id)}</span></div>
                    <div>Timestamp: <span className="text-neutral-900 font-semibold"><span className="font-mono">{formatTimestamp(selectedEvent.timestamp)}</span> ({typeof selectedEvent.timestamp === 'number' ? selectedEvent.timestamp.toFixed(1) : selectedEvent.timestamp}s)</span></div>
                    <div>Entities: <span className="text-neutral-900 font-semibold">{formatEntityName(selectedEvent.entity_id) || 'Global Scene'}</span></div>
                  </div>
                </div>

                {/* 1. What TRACE Observed */}
                {selectedEvent.explanation && (
                  <div className="flex flex-col gap-1 border-t border-line pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                      1. What TRACE Observed
                    </span>
                    <p className="text-neutral-800 leading-relaxed bg-paper p-2 border border-line font-sans">
                      {humanizeExplanation(selectedEvent.explanation, selectedEvent.scenario, selectedEvent.entity_id)}
                    </p>
                  </div>
                )}

                {/* 2. Safe Action Recommendation */}
                {selectedEvent.planner_recommendation ? (
                  <div className="flex flex-col gap-1 border-t border-line pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 flex items-center justify-between">
                      <span>2. Recommended Safe Action</span>
                      {selectedEvent.planner_recommendation.what_if_eligible && (
                        <span className="border border-emerald-300 bg-emerald-50 text-emerald-800 text-[9px] px-1.5 py-0.2 font-semibold">
                          WHAT-IF ELIGIBLE
                        </span>
                      )}
                    </span>
                    <div className="border border-emerald-400 bg-emerald-50/70 p-2.5 text-emerald-950 flex flex-col gap-2 shadow-sm">
                      <span className="font-semibold leading-relaxed">
                        {selectedEvent.planner_recommendation.action}
                      </span>
                      {selectedEvent.planner_recommendation.rationale && (
                        <p className="text-[11px] text-emerald-900/90 leading-normal border-t border-emerald-200/80 pt-1.5">
                          {selectedEvent.planner_recommendation.rationale}
                        </p>
                      )}
                    </div>
                  </div>
                ) : selectedEvent.recommended_action ? (
                  <div className="flex flex-col gap-1 border-t border-line pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                      2. Recommended Precaution
                    </span>
                    <div className="border border-line bg-neutral-50 p-2.5 text-neutral-900">
                      {selectedEvent.recommended_action}
                    </div>
                  </div>
                ) : null}

                {/* 3. Responsible AI Review Controls */}
                <div className="flex flex-col gap-2 border-t border-line pt-3 bg-neutral-50/50 p-3 border">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-700">
                      3. Responsible AI Operator Review
                    </span>
                    {selectedEvent.reviewed && selectedEvent.review_status ? (
                      <span className={`border px-1.5 py-0.2 text-[9px] font-bold ${REVIEW_BADGES[selectedEvent.review_status]?.style}`}>
                        {REVIEW_BADGES[selectedEvent.review_status]?.label}
                      </span>
                    ) : (
                      <span className="text-[10px] text-neutral-500 font-medium">
                        Status: Unreviewed
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-neutral-600 leading-normal">
                    Operator feedback feeds continuous learning. Flagging an event as False Positive logs the observation to Layer 9 memory.
                  </p>

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

                  <div className="flex flex-col gap-1">
                    <input
                      type="text"
                      placeholder="Optional supervisor review note..."
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      className="border border-line bg-white px-2 py-1 text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-neutral-500"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    <button
                      type="button"
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('confirmed_damage')}
                      className="border border-red-300 bg-white hover:bg-red-50 text-red-800 py-1.5 px-2 text-[10px] font-bold uppercase disabled:opacity-50 cursor-pointer"
                    >
                      Confirmed Damage
                    </button>
                    <button
                      type="button"
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('false_positive')}
                      className="border border-sky-300 bg-white hover:bg-sky-50 text-sky-800 py-1.5 px-2 text-[10px] font-bold uppercase disabled:opacity-50 cursor-pointer"
                    >
                      False Positive
                    </button>
                    <button
                      type="button"
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('unresolved')}
                      className="border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 py-1.5 px-2 text-[10px] font-bold uppercase disabled:opacity-50 cursor-pointer"
                    >
                      Unresolved
                    </button>
                  </div>
                </div>

                {/* 4. Progressive Disclosure: Technical Evidence & Limitations */}
                <div className="border-t border-line pt-2">
                  <button
                    type="button"
                    onClick={() => setShowTechnical(!showTechnical)}
                    className="text-[11px] text-neutral-600 hover:text-neutral-900 underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>{showTechnical ? '▲ Hide Technical Evidence & Limitations' : '▼ View Technical Evidence & Limitations'}</span>
                  </button>

                  {showTechnical && (
                    <div className="mt-2 flex flex-col gap-2.5 bg-paper p-3 border border-line text-[11px]">
                      {/* Evidence Key-Values */}
                      {selectedEvent.evidence && Object.keys(selectedEvent.evidence).length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="font-bold text-neutral-700 uppercase text-[10px]">
                            Sensor / Geometric Evidence
                          </span>
                          <div className="flex flex-col gap-1.5 font-mono text-[10px] bg-white p-2.5 border border-line">
                            {Object.entries(selectedEvent.evidence).map(([k, v]) => {
                              const item = formatEvidenceItem(k, v)
                              return (
                                <div key={k} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/40 pb-1 last:border-b-0">
                                  <span className="text-neutral-500 capitalize font-sans">{item.label}:</span>
                                  <span className="text-neutral-900 font-semibold break-all text-right">{item.text}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Epistemic Limitations */}
                      {selectedEvent.limitations && selectedEvent.limitations.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="font-bold text-neutral-700 uppercase text-[10px]">
                            Known Sensor & Camera Limitations
                          </span>
                          <ul className="list-disc list-inside text-neutral-600 text-[10px]">
                            {selectedEvent.limitations.map((lim, idx) => (
                              <li key={idx}>{lim.replace(/_/g, ' ')}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Audit Trace */}
                      <div className="flex flex-col gap-0.5 font-mono text-[10px] text-neutral-400 border-t border-line pt-1.5">
                        <span>Event Hash: #{selectedEvent.event_id}</span>
                        <span>Clip Reference: {selectedEvent.clip_path || 'Direct Video Stream'}</span>
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