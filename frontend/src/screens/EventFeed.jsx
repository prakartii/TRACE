import { useEffect, useState, useCallback, useMemo } from 'react'
import { ArrowLeft, ArrowRight, Play, RotateCcw, TriangleAlert } from 'lucide-react'
import { listEvents, getEvent, submitReview } from '../api/events.js'
import { getActionPlan } from '../api/actions.js'
import { listVideos } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import { getScenarioConfig, getVideoScenarioInfo, resolveIncidentTitle } from '../lib/scenarios.js'
import {
  formatConfidence,
  formatEntityName,
  formatScore,
  humanizeExplanation,
} from '../lib/format.js'
import TemporalRiskPanel from '../components/TemporalRiskPanel.jsx'
import { useIntervention } from '../context/InterventionContext.jsx'
import InterventionStatusChip from '../components/intervention/InterventionStatusChip.jsx'


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

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const filters = { limit, offset, order }
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
  }, [filterLens, filterStatus, filterBand, filterVideo, filterReviewState, order, offset, selectedEventId])

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

  const getVideoInfo = (videoId) => getVideoScenarioInfo(videoId)
  const getVideoName = (videoId) => getVideoScenarioInfo(videoId).cameraName

  return (
    <div className="flex flex-col gap-8">
      {/* header */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="mb-1 flex items-center gap-2 text-label font-medium text-ink-soft">
              <TriangleAlert size={13} />
              safety incident inbox
            </p>
            <h1 className="font-display text-display-lg font-semibold text-ink">Incidents</h1>
            <p className="mt-2 max-w-2xl text-body text-ink-soft">
              Detected safety events from monitored warehouse video, preserved as an auditable
              ledger with evidence, explanation, and a recommended action.
            </p>
          </div>
          <div className="border border-line bg-surface px-3 py-1.5 font-mono text-caption text-ink-soft">
            {events.length} loaded
          </div>
        </div>
      </section>

      {/* recommended demos triage */}
      <section className="border border-line bg-surface p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
        <span className="text-caption font-medium text-ink-soft">
          recommended demos:
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSelectedEventId(73)
              handleReplayIncident({ event_id: 73, video_id: 'ac99ff34e1bd2c13', timestamp: 36.67 })
            }}
            className="border border-signal/40 bg-signal/10 px-2.5 py-1 text-caption font-medium text-[#8a5f00] hover:bg-signal/20 transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <span>event #73</span>
            <span className="text-ink-faint">· box overhang &amp; action plan</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedEventId(75)
              handleReplayIncident({ event_id: 75, video_id: '93e4b1963c6fcd97', timestamp: 1.0 })
            }}
            className="border border-ok/40 bg-ok/10 px-2.5 py-1 text-caption font-medium text-ok hover:bg-ok/20 transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <span>event #75</span>
            <span className="text-ink-faint">· verified prevented</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedEventId(105)
              handleReplayIncident({ event_id: 105, video_id: '93e4b1963c6fcd97', timestamp: 0.0 })
            }}
            className="border border-danger/40 bg-danger/10 px-2.5 py-1 text-caption font-medium text-danger hover:bg-danger/20 transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <span>event #105</span>
            <span className="text-ink-faint">· dock edge hazard</span>
          </button>
        </div>
      </section>

      {/* filters */}
      <section className="border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-small font-semibold text-ink">filters</span>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1 text-caption text-ink-soft hover:text-ink cursor-pointer"
            >
              <RotateCcw size={13} />
              reset filters ({activeFilterCount})
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-6">
          <Filter
            label="risk lens"
            value={filterLens}
            onChange={(v) => {
              setFilterLens(v)
              setOffset(0)
            }}
            options={[
              ['', 'all lenses'],
              ['structural', 'structural'],
              ['behaviour', 'behaviour'],
              ['conformance', 'conformance'],
              ['environmental', 'environmental'],
            ]}
          />
          <Filter
            label="epistemic status"
            value={filterStatus}
            onChange={(v) => {
              setFilterStatus(v)
              setOffset(0)
            }}
            options={[
              ['', 'all statuses'],
              ['supported', 'supported'],
              ['probable', 'probable'],
              ['insufficient_evidence', 'insufficient evidence'],
              ['unsupported', 'unsupported'],
            ]}
          />
          <Filter
            label="risk band"
            value={filterBand}
            onChange={(v) => {
              setFilterBand(v)
              setOffset(0)
            }}
            options={[
              ['', 'all bands'],
              ['Critical', 'critical'],
              ['High', 'high'],
              ['Medium', 'medium'],
              ['Low', 'low'],
            ]}
          />
          <Filter
            label="camera / zone"
            value={filterVideo}
            onChange={(v) => {
              setFilterVideo(v)
              setOffset(0)
            }}
            options={[
              ['', 'all camera zones'],
              ...videos.map((v) => {
                const info = getVideoScenarioInfo(v.id || v.filename)
                return [v.id, `${info.scenarioTitle} — ${info.cameraName}`]
              }),
            ]}
          />
          <Filter
            label="review state"
            value={filterReviewState}
            onChange={(v) => {
              setFilterReviewState(v)
              setOffset(0)
            }}
            options={[
              ['', 'all states'],
              ['unreviewed', 'unreviewed'],
              ['reviewed', 'reviewed'],
              ['confirmed_damage', 'confirmed damage'],
              ['false_positive', 'false positive'],
              ['unresolved', 'unresolved'],
            ]}
          />
          <Filter
            label="time order"
            value={order}
            onChange={(v) => {
              setOrder(v)
              setOffset(0)
            }}
            options={[
              ['desc', 'newest first'],
              ['asc', 'oldest first'],
            ]}
          />
        </div>
      </section>

      {/* workspace */}
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        {/* feed */}
        <div className="flex flex-col gap-3 lg:col-span-7">
          <div className="flex items-center justify-between">
            <span className="text-small font-semibold text-ink">
              recorded incident list ({displayedEvents.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGroupSimilar(!groupSimilar)}
                className={`border px-2.5 py-1 text-caption font-medium transition-colors cursor-pointer ${
                  groupSimilar
                    ? 'border-ink bg-ink text-paper'
                    : 'border-line bg-surface text-ink-soft hover:text-ink'
                }`}
                title="Group repeated frame detections within 2 seconds into distinct incidents"
              >
                {groupSimilar ? 'grouped incidents' : 'raw detections'}
              </button>
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 border border-line bg-surface p-8 text-small text-ink-soft">
              <span className="h-4 w-4 animate-spin motion-reduce:animate-none border-2 border-ink border-t-transparent" />
              retrieving incidents from ledger…
            </div>
          )}

          {!loading && error && (
            <div className="border border-danger bg-danger/5 p-4 text-small text-danger">
              <p className="font-semibold">error querying incident ledger</p>
              <p className="mt-1 font-mono text-caption">{error}</p>
            </div>
          )}

          {!loading && !error && displayedEvents.length === 0 && (
            <div className="border border-line bg-surface p-12 text-center text-small text-ink-soft">
              no safety incidents match the active filters.
            </div>
          )}

          {!loading && !error && displayedEvents.length > 0 && (
            <div className="flex flex-col gap-2">
              {displayedEvents.map((ev) => {
                const isSelected = ev.event_id === selectedEventId
                const config = getScenarioConfig(ev.scenario)
                const title = resolveIncidentTitle(ev) || config.title || 'Observed condition'
                const explanationText = humanizeExplanation(
                  ev.explanation || ev.planner_recommendation?.rationale || config.whyItMatters,
                  ev.scenario,
                  ev.entity_id
                )
                const statusCls = STATUS_STYLE[ev.status] || STATUS_STYLE.insufficient_evidence
                const bandCls = ev.band ? BAND_STYLE[ev.band] || BAND_STYLE.Low : null
                const videoInfo = getVideoInfo(ev.video_id)

                return (
                  <button
                    key={ev.event_id}
                    onClick={() => setSelectedEventId(ev.event_id)}
                    className={`w-full border bg-surface p-4 text-left transition-colors cursor-pointer ${
                      isSelected ? 'border-ink' : 'border-line hover:border-line-strong'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {bandCls && (
                          <span className={`border px-2 py-0.5 text-label font-medium ${bandCls}`}>
                            {ev.band} risk
                          </span>
                        )}
                        <span className="text-caption text-ink-soft">{videoInfo.cameraName}</span>
                        <span className="font-mono text-caption font-semibold tabular-nums text-ink">
                          {formatTimestamp(ev.timestamp)}
                        </span>
                        {ev._clusterCount > 1 && (
                          <span className="border border-steel/40 bg-steel/10 px-1.5 py-0.5 text-label text-steel">
                            {ev._clusterCount} detections
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {activeAlertByEventId.get(ev.event_id) && (
                          <InterventionStatusChip
                            state={activeAlertByEventId.get(ev.event_id).state}
                            severity={activeAlertByEventId.get(ev.event_id).severity}
                            compact
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedAlert(activeAlertByEventId.get(ev.event_id))
                            }}
                          />
                        )}
                        <span className={`border px-1.5 py-0.5 text-label ${statusCls}`}>
                          {STATUS_LABEL[ev.status] || ev.status}
                        </span>
                        {ev.event_type === 'prevented' && (
                          <span className="border border-ok/40 bg-ok/10 px-1.5 py-0.5 text-label text-ok">prevented</span>
                        )}
                        {ev.event_type === 'near_miss' && (
                          <span className="border border-signal/40 bg-signal/10 px-1.5 py-0.5 text-label text-[#8a5f00]">near-miss</span>
                        )}
                      </div>

                    </div>

                    <div className="mt-3">
                      <h3 className="text-title font-semibold leading-tight text-ink">{title}</h3>
                      <p className="mt-1 text-small text-ink-soft">
                        <span className="font-medium text-ink">why it matters:</span> {explanationText}
                      </p>
                    </div>

                    {(ev.planner_recommendation?.action || ev.recommended_action || config.recommendedAction) && (
                      <div className="mt-3 border-l-2 border-ok bg-ok/5 px-3 py-2 text-small text-ink">
                        <span className="block text-label font-medium text-ok">recommended action</span>
                        {ev.planner_recommendation?.action || ev.recommended_action || config.recommendedAction}
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-caption">
                      <span className="text-ink-faint">{videoInfo.scenarioTitle}</span>
                      <div className="flex items-center gap-3">
                        <span
                          className={`font-semibold transition-colors ${
                            isSelected ? 'text-ink underline' : 'text-ink-soft hover:text-ink'
                          }`}
                        >
                          safe action plan →
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
                          className="inline-flex items-center gap-1 font-semibold text-ink transition-colors hover:text-ink-soft cursor-pointer"
                        >
                          <Play size={12} />
                          replay
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* pagination */}
          <div className="mt-2 flex items-center justify-between border border-line bg-surface px-4 py-2.5 text-small">
            <span className="text-caption text-ink-faint">
              showing {offset + 1}–{Math.min(offset + limit, offset + displayedEvents.length)}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="inline-flex items-center gap-1 border border-line px-2.5 py-1 text-caption text-ink transition-colors hover:bg-paper disabled:opacity-30 cursor-pointer"
              >
                <ArrowLeft size={13} />
                previous
              </button>
              <button
                type="button"
                disabled={events.length < limit}
                onClick={() => setOffset(offset + limit)}
                className="inline-flex items-center gap-1 border border-line px-2.5 py-1 text-caption text-ink transition-colors hover:bg-paper disabled:opacity-30 cursor-pointer"
              >
                next
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* detail */}
        <div className="lg:col-span-5 lg:sticky lg:top-6">
          <div className="border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-ok" />
                <span className="text-small font-semibold text-ink">safe action plan</span>
              </div>
              {selectedEvent && (
                <span className="font-mono text-caption text-ink-faint">#{selectedEvent.event_id}</span>
              )}
            </div>

            {detailLoading && (
              <div className="flex items-center gap-2 p-6 text-small text-ink-soft">
                <span className="h-4 w-4 animate-spin motion-reduce:animate-none border-2 border-ink border-t-transparent" />
                evaluating safe action plan for incident #{selectedEventId}…
              </div>
            )}

            {!detailLoading && detailError && (
              <div className="border-b border-danger p-4 text-small text-danger">
                <p className="font-semibold">failed to load event details</p>
                <p className="mt-1 font-mono text-caption">{detailError}</p>
              </div>
            )}

            {!detailLoading && !detailError && !selectedEvent && (
              <p className="p-6 text-small text-ink-soft">
                Select an incident from the list to view its prioritized safe action plan and video evidence.
              </p>
            )}

            {/* Selected Event: Grounded Safe Action Plan */}
            {!detailLoading && !detailError && selectedEvent && (
              <div className="flex flex-col gap-4 p-4">
                {/* 1. Video Context Hero Bar */}
                <div className="flex items-center justify-between bg-ink p-3 text-paper">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-label text-paper/60 uppercase">video evidence clip</span>
                    <span className="text-small font-medium text-paper">
                      {getVideoName(selectedEvent.video_id)} @ <span className="font-mono">{formatTimestamp(selectedEvent.timestamp)}</span>
                    </span>
                    <span className="text-caption text-paper/70 font-mono">
                      t={typeof selectedEvent.timestamp === 'number' ? selectedEvent.timestamp.toFixed(1) : selectedEvent.timestamp}s
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleReplayIncident(selectedEvent)}
                    className="inline-flex items-center gap-1.5 bg-paper px-3 py-1.5 text-caption font-semibold text-ink transition-colors hover:bg-line cursor-pointer"
                    title="View video replay for this incident"
                  >
                    replay incident
                    <ArrowRight size={13} />
                  </button>
                </div>

                {/* 2. Incident Title & Risk Band */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`border px-1.5 py-0.5 text-label font-medium ${
                        STATUS_STYLE[selectedEvent.status] || STATUS_STYLE.insufficient_evidence
                      }`}
                    >
                      {STATUS_LABEL[selectedEvent.status] || selectedEvent.status}
                    </span>
                    <span className="border border-line bg-paper px-1.5 py-0.5 text-label text-ink-soft">
                      {selectedEvent.lens}
                    </span>
                    {selectedEvent.confidence && (
                      <span className="text-caption text-ink-soft">
                        conf: <span className="font-mono tabular-nums">{formatConfidence(selectedEvent.confidence)}</span>
                      </span>
                    )}
                    {selectedEvent.band && (
                      <span className={`border px-1.5 py-0.5 text-label font-medium ${BAND_STYLE[selectedEvent.band] || BAND_STYLE.Low}`}>
                        {selectedEvent.band} risk
                      </span>
                    )}
                    {selectedEvent.event_type === 'prevented' && (
                      <span className="border border-ok/40 bg-ok/10 px-1.5 py-0.5 text-label text-ok">prevented</span>
                    )}
                    {selectedEvent.event_type === 'near_miss' && (
                      <span className="border border-signal/40 bg-signal/10 px-1.5 py-0.5 text-label text-[#8a5f00]">near-miss</span>
                    )}
                  </div>
                  <h2 className="text-title font-semibold leading-snug text-ink mt-1">
                    {actionPlan?.title || resolveIncidentTitle(selectedEvent)}
                  </h2>
                  <div className="text-caption text-ink-soft">
                    {getVideoName(selectedEvent.video_id)} · <span className="font-mono font-medium text-ink">{formatTimestamp(selectedEvent.timestamp)}</span> · entity: <span className="font-mono text-ink">{formatEntityName(selectedEvent.entity_id) || 'global scene'}</span>
                  </div>
                </div>

                {activeAlertByEventId.get(selectedEvent.event_id) && (
                  <div className="flex items-center justify-between rounded-lg border border-danger/40 bg-danger/5 p-3">
                    <div className="flex items-center gap-2">
                      <InterventionStatusChip
                        state={activeAlertByEventId.get(selectedEvent.event_id).state}
                        severity={activeAlertByEventId.get(selectedEvent.event_id).severity}
                      />
                      <span className="text-xs text-ink-soft">Active operational alert</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedAlert(activeAlertByEventId.get(selectedEvent.event_id))}
                      className="text-xs font-bold text-ink underline hover:text-danger cursor-pointer"
                    >
                      Manage Intervention →
                    </button>
                  </div>
                )}


                {/* 3. WHY THIS MATTERS */}
                <div className="flex flex-col gap-1 border-t border-line pt-3">
                  <span className="text-label font-medium text-ink-faint uppercase">why this matters</span>
                  <p className="border border-line bg-paper p-2.5 text-small text-ink leading-relaxed">
                    {actionPlan?.reason || selectedEvent.planner_recommendation?.rationale || selectedEvent.explanation || getScenarioConfig(selectedEvent.scenario).whyItMatters || 'Uncorrected handling hazards directly escalate risk to personnel safety and product integrity.'}
                  </p>
                </div>

                {/* 4. DO THIS NOW (Prioritized Action Guidance) */}
                <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                  <span className="text-label font-medium text-ok uppercase tracking-wider flex items-center justify-between">
                    <span>do this now</span>
                    {selectedEvent.band === 'Critical' && (
                      <span className="border border-danger/40 bg-danger/10 text-danger text-[9px] font-bold px-1.5 py-0.2 uppercase tracking-wide">
                        immediate
                      </span>
                    )}
                  </span>

                  <div className="border border-ok/30 bg-ok/5 p-3 text-small text-ink flex flex-col gap-2">
                    {actionPlan?.steps && actionPlan.steps.length > 1 ? (
                      <ol className="flex flex-col gap-1.5 list-none p-0 m-0">
                        {actionPlan.steps.map((step, idx) => (
                          <li key={idx} className="flex items-start gap-2 leading-relaxed">
                            <span className="w-4 h-4 rounded-full bg-ok text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <span className={idx === 0 ? "font-semibold text-ink" : "text-ink-soft"}>
                              {step.replace(/^\d+\.\s*/, '')}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="font-semibold leading-relaxed">
                        {actionPlan?.immediate_action || selectedEvent.planner_recommendation?.action || selectedEvent.recommended_action || getScenarioConfig(selectedEvent.scenario).recommendedAction}
                      </p>
                    )}
                  </div>
                </div>

                {/* 5. ✓ VERIFY */}
                <div className="flex flex-col gap-1 border-t border-line pt-3">
                  <span className="text-label font-medium text-ink-soft uppercase tracking-wider flex items-center gap-1.5">
                    <span className="text-ok font-bold">✓</span>
                    <span>verify</span>
                  </span>
                  <div className="border border-line bg-paper p-2.5 text-small text-ink leading-relaxed">
                    <p className="font-medium">
                      {actionPlan?.verification || "Confirm the corrective action is completed before resuming work."}
                    </p>
                  </div>
                </div>

                {/* 6. Primary Action Buttons */}
                <div className="border-t border-line pt-3 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => handleReplayIncident(selectedEvent)}
                    className="w-full inline-flex items-center justify-center gap-2 bg-ink px-4 py-2.5 text-small font-semibold text-paper transition-colors hover:bg-ink-soft cursor-pointer"
                  >
                    <span>view video evidence / replay incident</span>
                    <Play size={13} />
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
                      className="w-full inline-flex items-center justify-center gap-2 border border-ok/40 bg-ok/10 px-4 py-2 text-small font-semibold text-ok transition-colors hover:bg-ok/20 cursor-pointer"
                    >
                      <span>simulate alternative safe placement →</span>
                    </button>
                  )}
                </div>

                {/* 7. Operator Review */}
                <div className="flex flex-col gap-2 border border-line bg-paper p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-label font-medium text-ink-soft">operator review</span>
                    {selectedEvent.reviewed && selectedEvent.review_status ? (
                      <span className={`border px-1.5 py-0.5 text-label ${REVIEW_BADGES[selectedEvent.review_status]?.style}`}>
                        {REVIEW_BADGES[selectedEvent.review_status]?.label}
                      </span>
                    ) : (
                      <span className="text-caption text-ink-faint">unreviewed</span>
                    )}
                  </div>
                  <p className="text-caption text-ink-soft">
                    Operator feedback feeds continuous learning. Flagging a false positive is
                    logged to layer 9 memory.
                  </p>

                  {reviewMessage && (
                    <div
                      className={`border p-2 text-caption ${
                        reviewMessage.type === 'success'
                          ? 'border-ok/40 bg-ok/10 text-ok'
                          : 'border-danger bg-danger/5 text-danger'
                      }`}
                    >
                      {reviewMessage.text}
                    </div>
                  )}

                  <input
                    type="text"
                    placeholder="Optional supervisor review note…"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="border border-line bg-surface px-2 py-1.5 text-small text-ink placeholder:text-ink-faint focus:border-ink"
                  />

                  <div className="grid grid-cols-3 gap-px bg-line">
                    <button
                      type="button"
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('confirmed_damage')}
                      className="bg-surface px-2 py-1.5 text-caption font-medium text-danger transition-colors hover:bg-paper disabled:opacity-50 cursor-pointer"
                    >
                      confirmed damage
                    </button>
                    <button
                      type="button"
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('false_positive')}
                      className="bg-surface px-2 py-1.5 text-caption font-medium text-steel transition-colors hover:bg-paper disabled:opacity-50 cursor-pointer"
                    >
                      false positive
                    </button>
                    <button
                      type="button"
                      disabled={reviewLoading}
                      onClick={() => handleReviewSubmit('unresolved')}
                      className="bg-surface px-2 py-1.5 text-caption font-medium text-ink-soft transition-colors hover:bg-paper disabled:opacity-50 cursor-pointer"
                    >
                      unresolved
                    </button>
                  </div>
                </div>

                {/* 8. Progressive Disclosure: Why This Action? / Technical Details */}
                <div className="border-t border-line pt-2">
                  <button
                    type="button"
                    onClick={() => setShowTechnical(!showTechnical)}
                    className="flex items-center justify-between w-full text-caption text-ink-soft underline-offset-2 hover:text-ink hover:underline cursor-pointer py-1"
                  >
                    <span>why this action? (technical evidence &amp; limitations)</span>
                    <span className="font-mono text-caption">{showTechnical ? '▲' : '▾'}</span>
                  </button>

                  {showTechnical && (
                    <div className="mt-2 flex flex-col gap-2.5 border border-line bg-paper p-3 text-caption">
                      <div className="grid grid-cols-2 gap-2 text-caption">
                        <div><span className="text-ink-faint">Event ID:</span> <span className="font-mono font-semibold text-ink">#{selectedEvent.event_id}</span></div>
                        <div><span className="text-ink-faint">Evidence Status:</span> <span className="font-semibold text-ink">{actionPlan?.evidence_status || STATUS_LABEL[selectedEvent.status] || selectedEvent.status}</span></div>
                        <div><span className="text-ink-faint">Target Entity:</span> <span className="font-semibold text-ink">{formatEntityName(selectedEvent.entity_id) || 'Global scene'}</span></div>
                        <div><span className="text-ink-faint">Confidence:</span> <span className="font-mono font-semibold text-ink">{formatConfidence(selectedEvent.confidence)}</span></div>
                        <div><span className="text-ink-faint">Risk Score:</span> <span className="font-mono font-semibold text-ink">{formatScore(selectedEvent.risk_score)}</span></div>
                        <div><span className="text-ink-faint">Internal Scenario:</span> <span className="font-mono text-ink-soft">{selectedEvent.scenario}</span></div>
                      </div>

                      {/* Rule Source */}
                      <div className="text-caption text-ink-soft border-t border-line pt-1.5">
                        <span className="text-ink-faint">Grounded Source:</span> <span className="font-medium text-ink">{actionPlan?.source || "TRACE Operational Safety Catalog (deterministic rule)"}</span>
                      </div>

                      {/* Video Evidence Measurements */}
                      {selectedEvent.evidence && Object.keys(selectedEvent.evidence).length > 0 && (
                        <div>
                          <span className="text-label font-medium text-ink-soft">sensor / geometric evidence</span>
                          <div className="mt-1.5 divide-y divide-line border border-line bg-surface">
                            {Object.entries(selectedEvent.evidence).map(([k, v]) => {
                              const item = formatEvidenceItem(k, v)
                              return (
                                <div key={k} className="flex items-baseline justify-between gap-2 px-2.5 py-1 font-mono text-caption">
                                  <span className="text-ink-soft">{item.label}:</span>
                                  <span className="font-medium text-ink">{item.text}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {selectedEvent.limitations && selectedEvent.limitations.length > 0 && (
                        <div>
                          <span className="text-label font-medium text-ink-soft">known sensor &amp; camera limitations</span>
                          <ul className="mt-1 list-inside list-disc text-ink-soft">
                            {selectedEvent.limitations.map((lim, idx) => (
                              <li key={idx}>{lim.replace(/_/g, ' ')}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="border-t border-line pt-1.5 font-mono text-caption text-ink-faint">
                        <span>event hash: #{selectedEvent.event_id}</span>
                        <span className="block">clip: {selectedEvent.clip_path || 'direct video stream'}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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

function Filter({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-1 bg-surface p-3">
      <span className="text-label font-medium text-ink-faint">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-line bg-paper px-2 py-1.5 text-small text-ink focus:border-ink"
      >
        {options.map(([val, text]) => (
          <option key={val} value={val}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}
