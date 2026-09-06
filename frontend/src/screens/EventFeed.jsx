import { useEffect, useState, useCallback } from 'react'
import { listEvents, getEvent, submitReview } from '../api/events.js'
import { listVideos } from '../api/videos.js'

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
  image_space_support_hypothesis: 'Image-space support alignment hypothesis',
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
  const [events, setEvents] = useState([])
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

  // Helper to get video name
  const getVideoName = (videoId) => {
    const found = videos.find((v) => v.id === videoId || v.duplicate_of === videoId)
    if (found) {
      if (found.duplicate_of) {
        return `${found.filename} (Canonical Duplicate)`
      }
      return found.filename
    }
    return videoId || 'Unknown Video'
  }

  return (
    <div className="flex flex-col gap-6 text-ink">
      {/* 1. Header Banner & Operational Mental Model */}
      <div className="border border-line bg-white p-6 shadow-sm flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold tracking-tight text-neutral-900">
                Operational Event Feed
              </h1>
              <span className="border border-line bg-neutral-100 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-600">
                SQLite Audit Store
              </span>
            </div>
            <p className="text-xs text-neutral-600 max-w-2xl leading-relaxed">
              Chronological ledger of warehouse risk detections, epistemic certainty grades, and safe corrective actions recorded from real-time video perception.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="border border-line bg-paper px-2.5 py-1 text-neutral-700">
              Loaded Events: <strong className="font-bold text-neutral-950">{events.length}</strong>
            </span>
          </div>
        </div>

        {/* 5-Step Operational Triage Trace Banner */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 border-t border-line pt-3 mt-1 text-xs">
          <div className="flex flex-col gap-0.5 border-l-2 border-neutral-300 pl-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">1. What Happened</span>
            <span className="font-mono text-[11px] text-neutral-800">Detected Scenario</span>
          </div>
          <div className="flex flex-col gap-0.5 border-l-2 border-neutral-300 pl-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">2. Where / When</span>
            <span className="font-mono text-[11px] text-neutral-800">Video & Timestamp</span>
          </div>
          <div className="flex flex-col gap-0.5 border-l-2 border-neutral-300 pl-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">3. Certainty</span>
            <span className="font-mono text-[11px] text-neutral-800">Epistemic Status</span>
          </div>
          <div className="flex flex-col gap-0.5 border-l-2 border-neutral-300 pl-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">4. Severity</span>
            <span className="font-mono text-[11px] text-neutral-800">Risk Band & Score</span>
          </div>
          <div className="flex flex-col gap-0.5 border-l-2 border-emerald-500 pl-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">5. Recommended Action</span>
            <span className="font-mono text-[11px] text-emerald-900 font-semibold">Safe Intervention</span>
          </div>
        </div>
      </div>

      {/* 2. Structured Filters Toolbar */}
      <div className="border border-line bg-white p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 flex items-center gap-1.5">
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="bg-neutral-900 text-white text-[10px] font-mono px-1.5 py-0.2 rounded-full">
                {activeFilterCount}
              </span>
            )}
          </span>
          {activeFilterCount > 0 && (
            <button
              onClick={handleResetFilters}
              className="text-xs text-neutral-600 hover:text-neutral-900 underline font-mono"
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
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500 font-mono"
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
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500 font-mono"
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
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500 font-mono"
            >
              <option value="">All Bands</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          {/* Source Video Filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase text-neutral-500">Source Video</label>
            <select
              value={filterVideo}
              onChange={(e) => {
                setFilterVideo(e.target.value)
                setOffset(0)
              }}
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500 truncate font-mono"
            >
              <option value="">All Videos</option>
              {videos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.filename} {v.duplicate_of ? '(Duplicate)' : ''}
                </option>
              ))}
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
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500 font-mono"
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
              className="border border-line bg-paper px-2 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-500 font-mono"
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
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-700">
              Recorded Incident List ({events.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="border border-line bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed font-mono"
              >
                Previous
              </button>
              <span className="text-[11px] font-mono text-neutral-500">
                Offset: {offset}
              </span>
              <button
                disabled={events.length < limit || loading}
                onClick={() => setOffset(offset + limit)}
                className="border border-line bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed font-mono"
              >
                Next
              </button>
            </div>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="border border-line bg-white p-8 text-center flex flex-col items-center gap-2">
              <div className="w-5 h-5 border-2 border-neutral-800 border-t-transparent animate-spin" />
              <span className="text-xs font-mono text-neutral-600">
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
                onClick={fetchEvents}
                className="self-start border border-red-400 bg-white px-3 py-1 font-mono text-xs hover:bg-red-100"
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
                  onClick={handleResetFilters}
                  className="border border-neutral-800 bg-neutral-900 text-white px-3 py-1 text-xs font-mono hover:bg-neutral-800"
                >
                  Clear Active Filters
                </button>
              )}
            </div>
          )}

          {/* Feed List Items */}
          {!loading && !error && events.length > 0 && (
            <div className="flex flex-col gap-2">
              {events.map((ev) => {
                const isSelected = ev.event_id === selectedEventId
                const title = ev.planner_recommendation?.risk_title || SCENARIO_TITLES[ev.scenario] || ev.scenario?.replace(/_/g, ' ') || 'Observed Condition'
                const statusCls = STATUS_STYLE[ev.status] || STATUS_STYLE.insufficient_evidence
                const bandCls = ev.band ? (BAND_STYLE[ev.band] || BAND_STYLE.Low) : null
                const reviewBadge = ev.reviewed && ev.review_status ? REVIEW_BADGES[ev.review_status] : null

                return (
                  <button
                    key={ev.event_id}
                    onClick={() => setSelectedEventId(ev.event_id)}
                    className={`w-full text-left border bg-white p-3 transition-all flex flex-col gap-2 ${
                      isSelected
                        ? 'border-neutral-900 ring-1 ring-neutral-900 bg-neutral-50/60 shadow-sm'
                        : 'border-line hover:border-neutral-400'
                    }`}
                  >
                    {/* Top Row: Event ID, Timestamp, Badges */}
                    <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-neutral-900 bg-neutral-100 px-1.5 py-0.5 border border-line text-[11px]">
                          EVENT #{ev.event_id}
                        </span>
                        <span className="font-mono text-[11px] text-neutral-600">
                          {formatTimestamp(ev.timestamp)}
                        </span>
                        <span className={`border px-1.5 py-0.2 text-[10px] font-bold tracking-wide ${statusCls}`}>
                          {STATUS_LABEL[ev.status] || ev.status?.toUpperCase()}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {bandCls && (
                          <span className={`border px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wide ${bandCls}`}>
                            {ev.band} Severity
                          </span>
                        )}
                        <span className="border border-line bg-neutral-100 px-1.5 py-0.2 text-[10px] font-mono uppercase text-neutral-600 font-bold">
                          {ev.lens}
                        </span>
                        {reviewBadge ? (
                          <span className={`border px-1.5 py-0.2 text-[9px] uppercase tracking-wider ${reviewBadge.style}`}>
                            {reviewBadge.label}
                          </span>
                        ) : (
                          <span className="border border-neutral-300 bg-neutral-100 text-neutral-500 px-1.5 py-0.2 text-[9px] uppercase tracking-wider font-mono">
                            UNREVIEWED
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle Row: Human-Readable Scenario Title */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-bold text-neutral-900 leading-snug">
                        {title}
                      </span>
                      <span className="text-[10px] font-mono text-neutral-500 truncate">
                        Source: {getVideoName(ev.video_id)}
                      </span>
                    </div>

                    {/* Bottom Row: Recommended Safe Action Preview if available */}
                    {ev.planner_recommendation?.action && (
                      <div className="border-l-2 border-emerald-500 bg-emerald-50/40 p-1.5 text-[11px] text-emerald-950 font-medium">
                        <span className="font-bold text-emerald-800 text-[10px] uppercase tracking-wider mr-1">
                          Safe Action:
                        </span>
                        {ev.planner_recommendation.action}
                      </div>
                    )}
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
                <span className="text-xs font-mono text-neutral-600">
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
                <div className="border-l-2 border-neutral-400 bg-neutral-100 p-2 text-[11px] text-neutral-700 leading-relaxed font-mono">
                  <strong>ARCHIVED RECORD:</strong> This finding and recommendation were preserved at snapshot timestamp {formatTimestamp(selectedEvent.timestamp)}.
                </div>

                {/* Event Identification */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${STATUS_STYLE[selectedEvent.status] || STATUS_STYLE.insufficient_evidence}`}>
                      {STATUS_LABEL[selectedEvent.status] || selectedEvent.status?.toUpperCase()}
                    </span>
                    <span className="border border-line bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase text-neutral-700">
                      {selectedEvent.lens}
                    </span>
                    {selectedEvent.confidence && (
                      <span className="font-mono text-[10px] text-neutral-600">
                        CONF: {selectedEvent.confidence}
                      </span>
                    )}
                    {selectedEvent.band && (
                      <span className={`border px-1.5 py-0.5 text-[10px] font-bold uppercase ${BAND_STYLE[selectedEvent.band] || BAND_STYLE.Low}`}>
                        {selectedEvent.band} Risk
                      </span>
                    )}
                  </div>

                  <h2 className="text-sm font-bold text-neutral-900 leading-snug">
                    {selectedEvent.planner_recommendation?.risk_title || SCENARIO_TITLES[selectedEvent.scenario] || selectedEvent.scenario?.replace(/_/g, ' ')}
                  </h2>

                  <div className="text-[11px] font-mono text-neutral-600 flex flex-col gap-0.5 border-t border-line pt-2">
                    <div>Video: <span className="text-neutral-900 font-semibold">{getVideoName(selectedEvent.video_id)}</span></div>
                    <div>Timestamp: <span className="text-neutral-900 font-semibold">{formatTimestamp(selectedEvent.timestamp)} ({selectedEvent.timestamp}s)</span></div>
                    <div>Entities: <span className="text-neutral-900">{selectedEvent.entity_id || 'Global Scene'}</span></div>
                  </div>
                </div>

                {/* 1. What TRACE Observed */}
                {selectedEvent.explanation && (
                  <div className="flex flex-col gap-1 border-t border-line pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                      1. What TRACE Observed
                    </span>
                    <p className="text-neutral-800 leading-relaxed bg-paper p-2 border border-line">
                      {selectedEvent.explanation}
                    </p>
                  </div>
                )}

                {/* 2. Safe Action Recommendation */}
                {selectedEvent.planner_recommendation ? (
                  <div className="flex flex-col gap-1 border-t border-line pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 flex items-center justify-between">
                      <span>2. Recommended Safe Action</span>
                      {selectedEvent.planner_recommendation.what_if_eligible && (
                        <span className="border border-emerald-300 bg-emerald-50 text-emerald-800 text-[9px] px-1.5 py-0.2">
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
                      <span className="text-[10px] font-mono text-neutral-500">
                        Status: Unreviewed
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-neutral-600 leading-normal">
                    Operator feedback feeds continuous learning. Flagging an event as False Positive logs the observation to Layer 9 memory.
                  </p>

                  {reviewMessage && (
                    <div
                      className={`p-2 text-xs font-mono border ${
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
                      className="border border-line bg-white px-2 py-1 text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-neutral-500 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 pt-1">
                    <button
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('confirmed_damage')}
                      className="border border-red-300 bg-white hover:bg-red-50 text-red-800 py-1.5 px-2 text-[10px] font-bold uppercase disabled:opacity-50"
                    >
                      Confirmed Damage
                    </button>
                    <button
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('false_positive')}
                      className="border border-sky-300 bg-white hover:bg-sky-50 text-sky-800 py-1.5 px-2 text-[10px] font-bold uppercase disabled:opacity-50"
                    >
                      False Positive
                    </button>
                    <button
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('unresolved')}
                      className="border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 py-1.5 px-2 text-[10px] font-bold uppercase disabled:opacity-50"
                    >
                      Unresolved
                    </button>
                  </div>
                </div>

                {/* 4. Progressive Disclosure: Technical Evidence & Limitations */}
                <div className="border-t border-line pt-2">
                  <button
                    onClick={() => setShowTechnical(!showTechnical)}
                    className="text-[11px] font-mono text-neutral-600 hover:text-neutral-900 underline flex items-center gap-1"
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
                          <div className="grid grid-cols-2 gap-1 font-mono text-[10px] bg-white p-2 border border-line">
                            {Object.entries(selectedEvent.evidence).map(([k, v]) => {
                              const item = formatEvidenceItem(k, v)
                              return (
                                <div key={k} className="flex justify-between border-b border-line/60 pb-0.5">
                                  <span className="text-neutral-500 capitalize">{item.label}:</span>
                                  <span className="text-neutral-900 font-semibold">{item.text}</span>
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
                          <ul className="list-disc list-inside text-neutral-600 text-[10px] font-mono">
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