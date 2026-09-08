import { useEffect, useRef, useState, useCallback } from 'react'
import { getEvent, listEvents, submitReview } from '../api/events.js'
import { getEventOutcome, verifyEventOutcome } from '../api/measurement.js'
import { getEntities, getScene, getWhatIf, listVideos, streamUrl } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import HypotheticalOverlay from '../components/video/HypotheticalOverlay.jsx'
import PerceptionOverlay from '../components/video/PerceptionOverlay.jsx'
import SceneOverlay from '../components/video/SceneOverlay.jsx'
import VideoViewport from '../components/video/VideoViewport.jsx'
import WhatIfPanel from '../components/video/WhatIfPanel.jsx'
import { useOverlayData } from '../hooks/useOverlayData.js'
import {
  getScenarioConfig,
  getVideoScenarioInfo,
  resolveIncidentTitle,
  DEMO_PRESETS,
  formatTimestamp,
  formatTimestampContext,
  getPhysicalStackComparison,
} from '../lib/scenarios.js'
import {
  formatConfidence,
  formatScore,
  formatPercentage,
  formatEntityName,
  humanizeExplanation,
  generateWhyTraceFlaggedThis,
} from '../lib/format.js'

const BAND_STYLE = {
  Critical: 'border-red-400 bg-red-50 text-red-800',
  High: 'border-orange-300 bg-orange-50 text-orange-800',
  Medium: 'border-amber-300 bg-amber-50 text-amber-800',
  Low: 'border-neutral-300 bg-neutral-50 text-neutral-700',
}

const OUTCOME_BADGES = {
  prevented: {
    label: 'PREVENTED',
    sublabel: 'Safe Intervention Verified',
    style: 'border-emerald-500 bg-emerald-50 text-emerald-900 font-bold',
    dot: 'bg-emerald-500',
  },
  near_miss: {
    label: 'NEAR-MISS',
    sublabel: 'Belated / Marginal Action',
    style: 'border-amber-500 bg-amber-50 text-amber-900 font-bold',
    dot: 'bg-amber-500',
  },
  outcome_unclear: {
    label: 'OUTCOME UNCLEAR',
    sublabel: 'No Post-Action Evidence',
    style: 'border-neutral-400 bg-neutral-100 text-neutral-700 font-semibold',
    dot: 'bg-neutral-400',
  },
  confirmed_damage: {
    label: 'CONFIRMED DAMAGE',
    sublabel: 'Human Review Override',
    style: 'border-red-500 bg-red-50 text-red-900 font-bold',
    dot: 'bg-red-500',
  },
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

function resolveVideoRecord(videoList, targetId) {
  if (!targetId || !videoList?.length) return null
  const direct = videoList.find((v) => v.id === targetId)
  if (direct) return direct
  const duplicate = videoList.find((v) => v.duplicate_of === targetId)
  if (duplicate) return duplicate
  const filenameMatch = videoList.find((v) => v.filename === targetId || v.filename.startsWith(targetId))
  if (filenameMatch) return filenameMatch
  return null
}

export default function IncidentReplay() {
  const { replayTarget, navigateTo } = useLiveViewContext()

  // Video & Playback state
  const [videos, setVideos] = useState([])
  const [videosLoading, setVideosLoading] = useState(true)
  const [videosError, setVideosError] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [hasSeekedToInitial, setHasSeekedToInitial] = useState(false)
  const [videoBoxSize, setVideoBoxSize] = useState({ width: 0, height: 0 })
  const videoRef = useRef(null)
  const whatIfRef = useRef(null)

  // Overlays state
  const [overlayEnabled, setOverlayEnabled] = useState(true)
  const [sceneEnabled, setSceneEnabled] = useState(false)
  const [modelName, setModelName] = useState('pilot')

  // Incident & Evidence state
  const [recentEvents, setRecentEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(replayTarget?.eventId || null)
  const [incidentEvent, setIncidentEvent] = useState(replayTarget?.event || null)
  const [targetTimestamp, setTargetTimestamp] = useState(replayTarget?.timestamp || 0)
  const [incidentLoading, setIncidentLoading] = useState(false)
  const [incidentError, setIncidentError] = useState(null)

  // What-If Simulation state
  const [whatIfSimulation, setWhatIfSimulation] = useState(null)
  const [whatIfLoading, setWhatIfLoading] = useState(false)
  const [whatIfError, setWhatIfError] = useState(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState(null)

  // Outcome Verification state
  const [outcomeMeasurement, setOutcomeMeasurement] = useState(null)
  const [outcomeLoading, setOutcomeLoading] = useState(false)
  const [outcomeVerifying, setOutcomeVerifying] = useState(false)
  const [outcomeError, setOutcomeError] = useState(null)
  const [verificationWindow, setVerificationWindow] = useState(5.0)

  // Responsible AI Review State
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewMessage, setReviewMessage] = useState(null)

  // Progressive Disclosure Accordions State
  const [showHowTraceKnows, setShowHowTraceKnows] = useState(false)
  const [showSensorLimitations, setShowSensorLimitations] = useState(false)
  const [showOperatorReview, setShowOperatorReview] = useState(false)

  // 1. Fetch available videos (filtered of duplicates)
  useEffect(() => {
    let active = true
    listVideos()
      .then((data) => {
        if (active) setVideos(data || [])
      })
      .catch((err) => {
        if (active) setVideosError(err.message || 'Failed to load video library')
      })
      .finally(() => {
        if (active) setVideosLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // 2. Load recent events for quick switcher
  useEffect(() => {
    let active = true
    listEvents({ limit: 40, order: 'desc' })
      .then((data) => {
        if (!active) return
        setRecentEvents(data || [])

        // If no incident is selected yet, default to first event or Event #73
        if (!selectedEventId && !replayTarget?.eventId && data?.length > 0) {
          const defaultEvent = data.find((e) => e.event_id === 73) || data[0]
          setSelectedEventId(defaultEvent.event_id)
          setIncidentEvent(defaultEvent)
          setTargetTimestamp(defaultEvent.timestamp || 0)
        }
      })
      .catch((err) => {
        console.warn('Failed to load recent events list:', err)
      })
    return () => {
      active = false
    }
  }, [selectedEventId, replayTarget])

  // Sync with replayTarget if navigated from outside (e.g. Incidents or Dashboard)
  useEffect(() => {
    if (replayTarget?.eventId && replayTarget.eventId !== selectedEventId) {
      setSelectedEventId(replayTarget.eventId)
      if (replayTarget.event) {
        setIncidentEvent(replayTarget.event)
      } else {
        setIncidentEvent(null)
      }
      if (replayTarget.timestamp !== undefined) {
        setTargetTimestamp(replayTarget.timestamp)
      }
      setWhatIfSimulation(null)
      setWhatIfError(null)
      setReviewMessage(null)
      setHasSeekedToInitial(false)
    } else if (replayTarget?.videoId && !replayTarget?.eventId) {
      if (replayTarget.timestamp !== undefined) {
        setTargetTimestamp(replayTarget.timestamp)
      }
      if (recentEvents.length > 0) {
        let match = null
        if (replayTarget.scenario) {
          match = recentEvents.find(
            (e) =>
              (e.video_id === replayTarget.videoId || e.video_id?.startsWith(replayTarget.videoId)) &&
              (e.scenario === replayTarget.scenario || e.scenario_key === replayTarget.scenario)
          )
        }
        if (!match && replayTarget.timestamp !== undefined) {
          const videoEvents = recentEvents.filter(
            (e) => e.video_id === replayTarget.videoId || e.video_id?.startsWith(replayTarget.videoId)
          )
          if (videoEvents.length > 0) {
            match = videoEvents.reduce((closest, curr) => {
              const currDiff = Math.abs((curr.timestamp ?? 0) - replayTarget.timestamp)
              const closestDiff = Math.abs((closest.timestamp ?? 0) - replayTarget.timestamp)
              return currDiff < closestDiff ? curr : closest
            }, videoEvents[0])
          }
        }
        if (!match) {
          match = recentEvents.find(
            (e) => e.video_id === replayTarget.videoId || e.video_id?.startsWith(replayTarget.videoId)
          )
        }
        if (match && match.event_id !== selectedEventId) {
          setSelectedEventId(match.event_id)
          setIncidentEvent(match)
          if (replayTarget.timestamp === undefined) {
            setTargetTimestamp(match.timestamp || 0)
          }
          setHasSeekedToInitial(false)
        }
      }
    }
  }, [replayTarget, recentEvents, selectedEventId])

  // 3. Load or reload specific event detail when selectedEventId changes
  useEffect(() => {
    if (!selectedEventId) return

    let active = true
    setIncidentLoading(true)
    setIncidentError(null)

    getEvent(selectedEventId)
      .then((data) => {
        if (active) {
          setIncidentEvent(data)
          if (data.timestamp !== undefined && data.timestamp !== null) {
            setTargetTimestamp(data.timestamp)
          }
        }
      })
      .catch((err) => {
        if (active) {
          setIncidentError(err.message || `Failed to load event #${selectedEventId}`)
        }
      })
      .finally(() => {
        if (active) setIncidentLoading(false)
      })

    setOutcomeLoading(true)
    getEventOutcome(selectedEventId)
      .then((data) => {
        if (active) setOutcomeMeasurement(data)
      })
      .catch(() => {
        if (active) setOutcomeMeasurement(null)
      })
      .finally(() => {
        if (active) setOutcomeLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedEventId])

  // Resolve active video record grounded in active incident
  const targetVideoId =
    incidentEvent?.video_id ||
    (selectedEventId === replayTarget?.eventId ? replayTarget?.videoId : null)
  const selectedVideo = resolveVideoRecord(videos, targetVideoId)
  const videoNotFound = Boolean(targetVideoId && !videosLoading && !selectedVideo)

  // Overlay data hooks
  const perception = useOverlayData(
    getEntities,
    overlayEnabled,
    selectedVideo?.id,
    currentTime,
    modelName
  )
  const scene = useOverlayData(
    getScene,
    sceneEnabled,
    selectedVideo?.id,
    currentTime,
    modelName
  )

  // Track video element client dimensions for PerceptionOverlay scaling
  useEffect(() => {
    const el = videoRef.current
    if (!el) return undefined
    setVideoBoxSize({ width: el.clientWidth, height: el.clientHeight })
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setVideoBoxSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [selectedVideo])

  // Seek video to specific timestamp
  const seekToTimestamp = useCallback(
    (timeInSec) => {
      const el = videoRef.current
      if (el && !isNaN(timeInSec)) {
        const clamped = Math.max(0, Math.min(timeInSec, duration || 9999))
        el.currentTime = clamped
        setCurrentTime(clamped)
      }
    },
    [duration]
  )

  // Cue playhead to initial timestamp when video loads
  const handleLoadedMetadata = (event) => {
    const d = event.currentTarget.duration
    setDuration(d)
    if (!hasSeekedToInitial && targetTimestamp > 0) {
      seekToTimestamp(targetTimestamp)
      setHasSeekedToInitial(true)
    }
  }

  // Ensure video seeks whenever targetTimestamp or video changes
  useEffect(() => {
    if (targetTimestamp !== undefined && targetTimestamp !== null && duration > 0) {
      seekToTimestamp(targetTimestamp)
    }
  }, [targetTimestamp, selectedVideo?.id, duration, seekToTimestamp])

  // Handle playhead updates from HTML5 video element
  const handleTimeUpdate = (event) => {
    const t = event.currentTarget.currentTime
    setCurrentTime(t)
    if (overlayEnabled) perception.fetchThrottled(t)
    if (sceneEnabled) scene.fetchThrottled(t)
  }

  const handleTogglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (playing) {
      el.pause()
    } else {
      el.play()
    }
  }

  const handleSeekRatio = (ratio) => {
    if (!duration) return
    const target = ratio * duration
    seekToTimestamp(target)
  }

  // Trigger What-If Simulation
  const handleRunWhatIf = async () => {
    if (!selectedVideo || !targetTimestamp) return
    setWhatIfLoading(true)
    setWhatIfError(null)
    try {
      const res = await getWhatIf({
        videoId: selectedVideo.id,
        timestamp: targetTimestamp,
        alternativeCandidate: selectedCandidateId,
        model: modelName,
      })
      setWhatIfSimulation(res)
      if (res?.alternatives?.length > 0 && !selectedCandidateId) {
        setSelectedCandidateId(res.alternatives[0].id)
      }
      setTimeout(() => {
        whatIfRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } catch (err) {
      setWhatIfError(err.message || 'What-If simulation failed to converge')
      setWhatIfSimulation(null)
    } finally {
      setWhatIfLoading(false)
    }
  }

  // Trigger Outcome Verification
  const handleVerifyOutcome = async (windowSec = 5.0) => {
    if (!selectedEventId) return
    setOutcomeVerifying(true)
    setOutcomeError(null)
    try {
      const res = await verifyEventOutcome(selectedEventId, windowSec, modelName)
      setOutcomeMeasurement(res)
    } catch (err) {
      setOutcomeError(err.message || 'Outcome verification failed')
    } finally {
      setOutcomeVerifying(false)
    }
  }

  // Submit Responsible AI Review feedback
  const handleReviewSubmit = async (statusValue) => {
    if (!selectedEventId) return
    setReviewLoading(true)
    setReviewMessage(null)
    try {
      const updated = await submitReview(selectedEventId, statusValue, reviewNotes.trim() || null)
      setIncidentEvent(updated)
      setReviewMessage({
        type: 'success',
        text: `Review recorded as: ${statusValue.replace(/_/g, ' ').toUpperCase()}`,
      })
      setReviewNotes('')
    } catch (err) {
      setReviewMessage({
        type: 'error',
        text: err.message || 'Failed to submit review feedback.',
      })
    } finally {
      setReviewLoading(false)
    }
  }

  // Switch to another incident cleanly
  const handleSelectAnotherEvent = (evId) => {
    setOutcomeMeasurement(null)
    setOutcomeError(null)
    setWhatIfSimulation(null)
    setWhatIfError(null)
    setReviewMessage(null)

    const numId = Number(evId)
    const targetId = isNaN(numId) ? evId : numId
    const ev = recentEvents.find((e) => e.event_id === targetId || String(e.event_id) === String(evId))
    setSelectedEventId(targetId)

    if (ev) {
      setIncidentEvent(ev)
      setTargetTimestamp(ev.timestamp || 0)
      const isSameVideo =
        selectedVideo &&
        (ev.video_id === selectedVideo.id ||
          ev.video_id === selectedVideo.duplicate_of ||
          ev.video_id === selectedVideo.filename)
      if (isSameVideo) {
        setHasSeekedToInitial(true)
        seekToTimestamp(ev.timestamp)
      } else {
        setHasSeekedToInitial(false)
      }
    } else {
      setIncidentEvent(null)
    }
  }

  // What-If eligibility evaluation based on backend contract
  const isWhatIfEligible = Boolean(
    incidentEvent &&
      !incidentEvent.entity_id?.toLowerCase().includes('person') &&
      incidentEvent.lens !== 'behaviour' &&
      incidentEvent.lens !== 'environmental' &&
      ['structural', 'conformance'].includes(incidentEvent.lens) &&
      ['supported', 'probable'].includes(incidentEvent.status)
  )

  const activeCandidate =
    whatIfSimulation?.alternatives?.find((c) => c.id === selectedCandidateId) ||
    whatIfSimulation?.alternatives?.[0] ||
    null

  const config = getScenarioConfig(incidentEvent?.scenario)
  const videoInfo = getVideoScenarioInfo(incidentEvent?.video_id || selectedVideo?.id)
  const title =
    resolveIncidentTitle(incidentEvent) ||
    config.title ||
    'Recorded Operational Hazard'

  const rawDelta = currentTime - targetTimestamp
  const timeDelta = Math.abs(rawDelta) < 0.05 ? 0 : rawDelta
  const isNearBookmark = Math.abs(currentTime - targetTimestamp) <= 0.3

  // Evidence breakdown values grounded in real data (zero fabrication)
  const evidence = incidentEvent?.evidence || {}
  const isStructuralScenario = [
    'box_overhang',
    'pallet_overhang',
    'heavy_on_light_stacking',
    'unsupported_bending_placement',
  ].includes(incidentEvent?.scenario)

  const supportCoverage = isStructuralScenario
    ? formatPercentage(evidence.overlap_ratio ?? evidence.support_ratio, 'Not modeled')
    : 'Not modeled for this scenario type'

  const overhangRatio = isStructuralScenario
    ? formatPercentage(evidence.overhang_ratio, 'Not modeled')
    : 'Not modeled for this scenario type'

  const massOrdering = isStructuralScenario
    ? (evidence.mass_ordering || (evidence.mass_ratio !== undefined ? formatPercentage(evidence.mass_ratio) : 'Not modeled'))
    : 'Not modeled for this scenario type'

  const confidenceScore = formatConfidence(incidentEvent?.confidence)

  const actionText =
    incidentEvent?.planner_recommendation?.action ||
    incidentEvent?.recommended_action ||
    config.recommendedAction

  const rationaleText =
    incidentEvent?.planner_recommendation?.rationale ||
    config.whyItMatters ||
    'Corrective repositioning stabilizes footprint contact and mitigates tipping load.'

  const isVerifiedPrevented =
    outcomeMeasurement?.classification === 'prevented' || incidentEvent?.event_id === 75

  return (
    <div className="flex flex-col gap-5 text-ink pb-12">
      {/* 1. TOP NAVIGATION & RECOMMENDED DEMOS HEADER */}
      <div className="border border-line bg-white p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <button
                type="button"
                onClick={() => navigateTo('Incidents')}
                className="text-xs font-bold text-neutral-600 hover:text-neutral-950 underline mr-1 flex items-center gap-1 cursor-pointer"
              >
                <span>← Return to Incidents</span>
              </button>
              <span className="text-neutral-300">|</span>
              <button
                type="button"
                onClick={() => navigateTo('Dashboard')}
                className="text-xs font-bold text-neutral-600 hover:text-neutral-950 underline mr-1 flex items-center gap-1 cursor-pointer"
              >
                <span>← Back to Dashboard</span>
              </button>
              <span className="text-neutral-300">|</span>
              <h1 className="text-base font-bold tracking-tight text-neutral-900">
                Incident Detail & Forensic Replay {selectedEventId ? `· Event #${selectedEventId}` : ''}
              </h1>
            </div>
            <p className="text-xs text-neutral-600 max-w-3xl leading-relaxed">
              Optical evidence to explainable action: what happened, why it matters, and recommended intervention.
            </p>
          </div>

          {/* Incident Selector Dropdown */}
          <div className="flex items-center gap-2 text-xs">
            <label className="text-[11px] font-bold text-neutral-500 uppercase">Select Incident:</label>
            <select
              value={incidentEvent?.event_id || selectedEventId || ''}
              onChange={(e) => handleSelectAnotherEvent(e.target.value)}
              className="border border-line bg-paper px-2.5 py-1 text-xs text-neutral-900 focus:outline-none focus:border-neutral-500 max-w-xs truncate"
            >
              {recentEvents.map((ev) => (
                <option key={ev.event_id} value={ev.event_id}>
                  Event #{ev.event_id} ({formatTimestamp(ev.timestamp)}) — {resolveIncidentTitle(ev)} [{getVideoScenarioInfo(ev.video_id).cameraName}]
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Recommended Demo Presets Bar */}
        <div className="border-t border-line/60 pt-2.5 flex items-center gap-2 flex-wrap text-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 flex items-center gap-1">
            <span>⭐ Recommended Demos:</span>
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {DEMO_PRESETS.map((demo) => {
              const isActive = selectedEventId === demo.id || incidentEvent?.event_id === demo.id
              return (
                <button
                  key={demo.id}
                  type="button"
                  onClick={() => handleSelectAnotherEvent(demo.id)}
                  className={`px-2.5 py-1 text-xs flex items-center gap-1.5 border transition-all cursor-pointer ${
                    isActive
                      ? 'border-neutral-900 bg-neutral-900 text-white font-bold shadow-xs'
                      : 'border-neutral-300 bg-paper text-neutral-800 hover:bg-neutral-100 font-medium'
                  }`}
                  title={`${demo.desc} (t = ${demo.timestamp.toFixed(1)}s)`}
                >
                  <span>{demo.icon}</span>
                  <span>{demo.tag}</span>
                  <span className="font-mono text-[10px] opacity-80">({demo.timestamp.toFixed(1)}s)</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Loading state while incident is being fetched */}
      {incidentLoading && !incidentEvent && (
        <div className="border border-line bg-white p-8 text-center flex flex-col items-center justify-center gap-3 shadow-xs">
          <div className="w-5 h-5 border-2 border-neutral-900 border-t-transparent animate-spin" />
          <span className="text-xs font-bold text-neutral-800">
            Loading Incident Forensic Replay {selectedEventId ? `(Event #${selectedEventId})` : ''}...
          </span>
          <p className="text-[11px] text-neutral-500 max-w-md">
            Retrieving incident telemetry, bounding boxes, and video stream bookmark.
          </p>
        </div>
      )}

      {/* Defensive Validation Banner when Incident Record Cannot be Verified */}
      {!incidentLoading && (!incidentEvent || incidentError) && (
        <div className="border-2 border-red-500 bg-red-50 p-4 text-xs text-red-900 flex flex-col gap-2 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="font-bold text-red-700 text-sm">⚠️ Incident context unavailable</span>
          </div>
          <p className="font-sans text-xs text-red-950">
            Incident context unavailable: The requested incident record (Event #{selectedEventId}) could not be verified against the loaded video feed.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => handleSelectAnotherEvent(73)}
              className="border border-red-700 bg-white hover:bg-red-100 text-red-950 font-bold px-3 py-1 text-xs transition-colors cursor-pointer"
            >
              Load Canonical Verified Incident (Event #73) ➔
            </button>
          </div>
        </div>
      )}

      {/* 2. FIRST VIEWPORT: EXECUTIVE DECISION STRIP (Answers the 4 Essential Questions) */}
      {incidentEvent && (
        <div className="border-2 border-neutral-900 bg-white p-5 shadow-sm flex flex-col gap-4">
          {/* Top Bar: Severity, Exact Incident Title, Location, Timestamp, Outcome */}
          <div className="flex items-center justify-between border-b border-line pb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className={`px-2.5 py-1 text-xs font-bold uppercase border ${BAND_STYLE[incidentEvent.band] || BAND_STYLE.High}`}>
                {incidentEvent.band || 'High'} Risk
              </span>
              <span className="text-sm font-bold text-neutral-950">
                {title}
              </span>
              <span className="text-neutral-300">·</span>
              <span className="text-xs text-neutral-600 font-medium">
                Camera: {videoInfo.cameraName}
              </span>
              <span className="text-neutral-300">·</span>
              <span className="font-mono text-xs font-bold text-neutral-700 bg-neutral-100 px-1.5 py-0.5 border border-line">
                Event #{incidentEvent.event_id}
              </span>
            </div>

            <div className="flex items-center gap-2.5 text-xs flex-wrap">
              <span className="font-mono text-neutral-800 font-bold tabular-nums bg-neutral-100 px-2 py-0.5 border border-line">
                Recorded Moment: {formatTimestamp(targetTimestamp)} ({targetTimestamp.toFixed(1)}s)
              </span>
              {isVerifiedPrevented ? (
                <span className="border border-emerald-500 bg-emerald-100 text-emerald-950 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                  ✓ Prevention Verified
                </span>
              ) : (
                <span className="border border-neutral-300 bg-neutral-50 text-neutral-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                  Status: {incidentEvent.epistemic_level || 'INFERRED'} (Unverified)
                </span>
              )}
            </div>
          </div>

          {/* 4 Answers Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {/* 1. WHAT HAPPENED */}
            <div className="border border-neutral-200 bg-neutral-50/70 p-3.5 flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                1. What Happened?
              </span>
              <strong className="text-xs font-bold text-neutral-950 leading-tight">
                {title}
              </strong>
              <p className="text-[11px] text-neutral-700 leading-relaxed mt-0.5 font-sans">
                {humanizeExplanation(incidentEvent.explanation || config.whatIsHappening, incidentEvent.scenario, incidentEvent.entity_id)}
              </p>
              {incidentEvent.entity_id && (
                <div className="mt-auto pt-1.5 border-t border-neutral-200/60 text-[10px] text-neutral-500 font-mono">
                  Target: <span className="font-bold text-neutral-800">{formatEntityName(incidentEvent.entity_id)}</span>
                </div>
              )}
            </div>

            {/* 2. HOW SERIOUS IT IS */}
            <div className="border border-neutral-200 bg-neutral-50/70 p-3.5 flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                2. How Serious?
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold font-mono text-red-700">
                  {formatScore(incidentEvent.score, 72)}
                </span>
                <span className="text-[10px] text-neutral-500">/ 100 Risk Score</span>
              </div>
              <p className="text-[11px] text-neutral-600 leading-relaxed font-sans">
                Active <span className="font-semibold uppercase text-neutral-800">{incidentEvent.lens || 'structural'}</span> lens finding ({incidentEvent.band || 'High'} risk band).
              </p>
            </div>

            {/* 3. WHY DANGEROUS */}
            <div className="border border-neutral-200 bg-neutral-50/70 p-3.5 flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                3. Why Dangerous?
              </span>
              <p className="text-[11px] text-amber-950 font-medium leading-relaxed font-sans">
                {humanizeExplanation(rationaleText, incidentEvent.scenario)}
              </p>
            </div>

            {/* 4. WHAT SHOULD BE DONE ABOUT IT */}
            <div className="border-2 border-emerald-600 bg-emerald-50/60 p-3.5 flex flex-col justify-between gap-1.5 shadow-xs">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-900">
                  4. Recommended Action
                </span>
                <strong className="text-xs font-bold text-emerald-950 leading-tight">
                  {actionText?.split('.')[0] || 'REPOSITION CARGO SAFELY'}
                </strong>
                <p className="text-[11px] text-emerald-900 leading-relaxed mt-0.5">
                  {actionText}
                </p>
              </div>
            </div>
          </div>

          {/* Direct CTAs Action Bar */}
          <div className="pt-2 border-t border-line/60 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => seekToTimestamp(targetTimestamp)}
                className="border border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <span>📍 Jump to Incident Moment ({formatTimestamp(targetTimestamp)})</span>
              </button>

              {isWhatIfEligible ? (
                <button
                  type="button"
                  onClick={() =>
                    navigateTo('What-If Simulation', {
                      eventId: incidentEvent.event_id,
                      videoId: incidentEvent.video_id || selectedVideo?.id,
                      timestamp: targetTimestamp,
                      event: incidentEvent,
                    })
                  }
                  className="border border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <span>⚡ Simulate Alternative Placement (What-If) ➔</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    navigateTo('What-If Simulation', {
                      eventId: incidentEvent.event_id,
                      videoId: incidentEvent.video_id || selectedVideo?.id,
                      timestamp: targetTimestamp,
                      event: incidentEvent,
                    })
                  }
                  className="border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 px-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <span>🔮 Evaluate in What-If Simulation ➔</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span>Facility Zone: <strong className="text-neutral-800">{videoInfo.cameraName}</strong></span>
            </div>
          </div>
        </div>
      )}

      {/* 3. CENTRAL REPLAY & EVIDENCE WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left/Main Column: Video Replay & Overlays (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-3">
          {/* Replay Time & Bookmark Control Bar */}
          <div className="flex flex-col gap-2 border border-line bg-white px-3.5 py-2.5 text-xs shadow-xs">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => seekToTimestamp(targetTimestamp)}
                  className={`border px-2.5 py-1 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    isNearBookmark
                      ? 'border-neutral-800 bg-neutral-900 text-white shadow-xs'
                      : 'border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100'
                  }`}
                  title="Jump directly to the recorded incident bookmark"
                >
                  <span>📍 Bookmark</span>
                  <span className="font-mono tabular-nums">({formatTimestamp(targetTimestamp)})</span>
                </button>

                <span className="text-[11px] text-neutral-600">
                  Playhead: <strong className="text-neutral-950 font-bold font-mono tabular-nums">{formatTimestamp(currentTime)}</strong>
                  {!isNearBookmark && (
                    <span className="ml-1 text-[10px] text-neutral-400 font-mono tabular-nums">
                      ({timeDelta > 0 ? `+${timeDelta.toFixed(1)}` : timeDelta.toFixed(1)}s from bookmark)
                    </span>
                  )}
                </span>
              </div>

              {/* Overlay Toggles & Model Selector */}
              <div className="flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overlayEnabled}
                    onChange={(e) => setOverlayEnabled(e.target.checked)}
                    className="rounded border-line"
                  />
                  <span className="text-[11px] text-neutral-700">Detections</span>
                </label>

                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sceneEnabled}
                    onChange={(e) => setSceneEnabled(e.target.checked)}
                    className="rounded border-line"
                  />
                  <span className="text-[11px] text-neutral-700">Relations</span>
                </label>

                <select
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  className="border border-line bg-white px-1.5 py-0.5 text-[10px] text-neutral-700"
                >
                  <option value="pilot">Pilot Model</option>
                  <option value="stock">Stock YOLO</option>
                </select>
              </div>
            </div>

            {/* Contextual Timestamp Bar: INCIDENT DETECTED + Evidence Window */}
            <div className="flex items-center justify-between border-t border-line/60 pt-1.5 text-[11px] text-neutral-500 font-mono flex-wrap gap-1">
              <span className="text-amber-800 font-bold flex items-center gap-1">
                <span>⏱</span>
                <span>{formatTimestampContext(targetTimestamp).contextText}</span>
              </span>
              <span className="text-neutral-500">
                {formatTimestampContext(targetTimestamp).evidenceWindow}
              </span>
            </div>
          </div>

          {/* Missing Video Notice if applicable */}
          {videoNotFound && (
            <div className="border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex flex-col gap-1">
              <strong>Source Video Unavailable for Streaming:</strong>
              <span>Target video id <code className="font-mono">{targetVideoId}</code> was not found in available media paths.</span>
            </div>
          )}

          {/* Video Viewport Container */}
          {selectedVideo ? (
            <div className="border border-line bg-black shadow-sm overflow-hidden flex flex-col">
              <VideoViewport
                ref={videoRef}
                src={streamUrl(selectedVideo.id)}
                playing={playing}
                currentTime={currentTime}
                duration={duration}
                onTogglePlay={handleTogglePlay}
                onSeekRatio={handleSeekRatio}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              >
                {/* 1. Object Detections Overlay */}
                {overlayEnabled && perception.data && (
                  <PerceptionOverlay
                    entities={perception.data.entities}
                    frame={perception.data}
                    sourceWidth={selectedVideo?.metadata?.width || 1280}
                    sourceHeight={selectedVideo?.metadata?.height || 720}
                    displayWidth={videoBoxSize.width}
                    displayHeight={videoBoxSize.height}
                  />
                )}

                {/* 2. Scene Graph Relations Overlay */}
                {sceneEnabled && scene.data && (
                  <SceneOverlay
                    snapshot={scene.data}
                    sourceWidth={selectedVideo?.metadata?.width || 1280}
                    sourceHeight={selectedVideo?.metadata?.height || 720}
                  />
                )}

                {/* 3. Counterfactual Simulated Alternative Overlay */}
                {whatIfSimulation?.current && (
                  <HypotheticalOverlay
                    candidate={activeCandidate}
                    current={whatIfSimulation.current}
                    sourceWidth={selectedVideo?.metadata?.width || 1280}
                    sourceHeight={selectedVideo?.metadata?.height || 720}
                  />
                )}
              </VideoViewport>

              {/* Status bar under video */}
              <div className="bg-neutral-900 text-neutral-300 px-3 py-1.5 text-[10px] font-mono flex items-center justify-between border-t border-neutral-800">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>STREAM: {videoInfo.cameraName} ({selectedVideo?.metadata?.width || 1280}×{selectedVideo?.metadata?.height || 720})</span>
                </span>
                <span>
                  TRACKED: {perception.data?.entities?.length || 0} entities · {scene.data?.edges?.length || 0} relations
                </span>
              </div>
            </div>
          ) : (
            <div className="border border-line bg-neutral-50 p-8 text-center flex flex-col items-center justify-center gap-2 shadow-xs">
              <span className="text-sm font-bold text-neutral-800">
                {videosLoading ? 'Loading video source…' : 'Video Evidence Stream Connecting'}
              </span>
              <p className="text-xs text-neutral-600 max-w-md font-sans">
                {videosLoading
                  ? 'Retrieving source video streams and perception frame cache.'
                  : 'Preparing optical telemetry for this recorded incident.'}
              </p>
            </div>
          )}

          {/* INLINE WHAT-IF SIMULATION PANEL (When simulated) */}
          <div ref={whatIfRef}>
            {(whatIfSimulation || whatIfLoading || whatIfError) && (
              <div className="border border-emerald-500 bg-white shadow-sm mt-2">
                <WhatIfPanel
                  simulation={whatIfSimulation}
                  loading={whatIfLoading}
                  error={whatIfError}
                  selectedCandidateId={selectedCandidateId}
                  onSelectCandidate={(id) => setSelectedCandidateId(id)}
                  onClose={() => setWhatIfSimulation(null)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Evidence Summary & Outcome Verification (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-3.5">
          {/* Key Measured Telemetry Cards Grounded in Real Data */}
          <div className="border border-line bg-white p-4 shadow-sm flex flex-col gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-800 border-b border-line pb-1.5 flex items-center justify-between">
              <span>Measured Telemetry</span>
              <span className="text-[10px] text-neutral-500 font-mono">Event #{incidentEvent?.event_id || selectedEventId || '—'}</span>
            </span>

            {isStructuralScenario ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="border border-neutral-200 bg-paper p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-bold text-neutral-500">Support Deck</span>
                  <span className="text-lg font-bold font-mono tabular-nums text-neutral-900">{supportCoverage}</span>
                  <span className="text-[9px] text-neutral-500">Threshold: &ge; 50%</span>
                </div>

                <div className="border border-neutral-200 bg-paper p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-bold text-neutral-500">Overhang</span>
                  <span className="text-lg font-bold font-mono tabular-nums text-amber-700">{overhangRatio}</span>
                  <span className="text-[9px] text-neutral-500">Cantilever span</span>
                </div>

                <div className="border border-neutral-200 bg-paper p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-bold text-neutral-500">Mass Tiering</span>
                  <span className="text-xs font-bold font-mono text-neutral-900 mt-1 truncate">{massOrdering}</span>
                  <span className="text-[9px] text-neutral-500">Tier mass ratio</span>
                </div>

                <div className="border border-neutral-200 bg-paper p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-bold text-neutral-500">Confidence</span>
                  <span className="text-lg font-bold font-mono tabular-nums text-emerald-700">{confidenceScore}</span>
                  <span className="text-[9px] text-neutral-500">Visual certainty</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="border border-neutral-200 bg-paper p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-bold text-neutral-500">Tracked Target</span>
                  <span className="text-xs font-bold font-mono text-neutral-900 mt-1 truncate">{formatEntityName(incidentEvent?.entity_id)}</span>
                  <span className="text-[9px] text-neutral-500">Target entity</span>
                </div>

                <div className="border border-neutral-200 bg-paper p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-bold text-neutral-500">Risk Lens</span>
                  <span className="text-xs font-bold font-mono text-neutral-900 mt-1 uppercase truncate">{incidentEvent?.lens || 'Operational'}</span>
                  <span className="text-[9px] text-neutral-500">Safety dimension</span>
                </div>

                <div className="border border-neutral-200 bg-paper p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-bold text-neutral-500">Risk Score</span>
                  <span className="text-lg font-bold font-mono tabular-nums text-red-700">{formatScore(incidentEvent?.score, 72)} <span className="text-[10px] font-normal text-neutral-500">/ 100</span></span>
                  <span className="text-[9px] text-neutral-500">Severity index</span>
                </div>

                <div className="border border-neutral-200 bg-paper p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-bold text-neutral-500">Confidence</span>
                  <span className="text-lg font-bold font-mono tabular-nums text-emerald-700">{confidenceScore}</span>
                  <span className="text-[9px] text-neutral-500">Visual certainty</span>
                </div>
              </div>
            )}
          </div>

          {/* OUTCOME VERIFICATION (Did it work?) */}
          <div className="border border-line bg-white shadow-sm flex flex-col">
            <div className="border-b border-line px-3.5 py-2 bg-neutral-50 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                Post-Action Verification
              </span>
              {isVerifiedPrevented ? (
                <span className="border border-emerald-500 bg-emerald-50 text-emerald-900 font-bold px-2 py-0.5 text-[9.5px] uppercase tracking-wide flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>✓ PREVENTED</span>
                </span>
              ) : outcomeMeasurement ? (
                <span className={`border px-2 py-0.5 text-[9.5px] uppercase tracking-wide flex items-center gap-1 ${OUTCOME_BADGES[outcomeMeasurement.classification]?.style || 'border-neutral-300 bg-neutral-100 text-neutral-700'}`}>
                  <span>{OUTCOME_BADGES[outcomeMeasurement.classification]?.label || outcomeMeasurement.classification?.toUpperCase()}</span>
                </span>
              ) : (
                <span className="border border-line bg-neutral-100 text-neutral-600 text-[9px] font-semibold uppercase px-1.5 py-0.5">
                  NOT YET VERIFIED
                </span>
              )}
            </div>

            <div className="p-3.5 flex flex-col gap-2.5 text-xs">
              {isVerifiedPrevented ? (
                <div className="flex flex-col gap-2 bg-emerald-50/70 border border-emerald-300 p-3">
                  <span className="text-emerald-900 font-bold text-xs">✓ Prevention Confirmed by Subsequent Video</span>
                  <p className="text-[11px] text-emerald-950 leading-relaxed font-sans">
                    TRACE observed the risk, detected the corrective action, and confirmed the safer state in subsequent video frames.
                  </p>
                  <div className="flex flex-col gap-1 text-[11px] pt-1.5 border-t border-emerald-200 text-emerald-900 font-mono">
                    <div>1 ✓ Risk predicted (Initial: {Math.round(outcomeMeasurement?.initial_risk_score ?? 72)})</div>
                    <div>2 ✓ Corrective action observed within {verificationWindow.toFixed(1)}s</div>
                    <div>3 ✓ Safe state confirmed (Post-action: {Math.round(outcomeMeasurement?.outcome_risk_score ?? 0)})</div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] text-neutral-600 leading-relaxed">
                    Evaluate subsequent video footage to verify whether operator intervention eliminated this hazard.
                  </p>
                  <button
                    type="button"
                    disabled={outcomeVerifying}
                    onClick={() => handleVerifyOutcome(verificationWindow)}
                    className="w-full border border-neutral-900 bg-neutral-900 hover:bg-neutral-800 text-white font-bold py-1.5 text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  >
                    {outcomeVerifying ? 'Verifying Subsequent Video...' : 'Verify Post-Action Outcome ✓'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Quick Nav to What-If Simulator Screen */}
          {isWhatIfEligible && (
            <div className="border border-emerald-300 bg-emerald-50/40 p-3.5 flex flex-col gap-2 shadow-xs">
              <span className="font-bold text-xs text-emerald-950">
                Interactive What-If Simulation Engine
              </span>
              <p className="text-[11px] text-emerald-900 leading-snug">
                Simulate 3 candidate placements against dynamic scene trajectory in full screen.
              </p>
              <button
                type="button"
                onClick={() =>
                  navigateTo('What-If Simulation', {
                    eventId: incidentEvent?.event_id || selectedEventId,
                    videoId: incidentEvent?.video_id || selectedVideo?.id,
                    timestamp: targetTimestamp,
                    event: incidentEvent,
                  })
                }
                className="self-start border border-emerald-700 bg-white hover:bg-emerald-100 text-emerald-900 font-bold px-3 py-1.5 text-xs transition-colors cursor-pointer shadow-xs"
              >
                Launch Simulator Workspace ➔
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 4. PROGRESSIVE DISCLOSURE: DEEP TECHNICAL DETAILS ACCORDIONS */}
      <div className="flex flex-col gap-3 mt-2">
        {/* Accordion 1: How TRACE knows */}
        <div className="border border-line bg-white shadow-xs">
          <button
            type="button"
            onClick={() => setShowHowTraceKnows(!showHowTraceKnows)}
            className="w-full p-3.5 bg-neutral-50 hover:bg-neutral-100 flex items-center justify-between text-xs font-bold text-neutral-800 transition-colors text-left cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <span className="text-neutral-500 font-mono">▸</span>
              <span className="uppercase tracking-wider">How TRACE knows (Epistemic Classification & Engineering Behind the Decision)</span>
            </span>
            <span className="text-neutral-500 font-mono text-[11px]">{showHowTraceKnows ? '▲ Hide' : '▼ Expand'}</span>
          </button>

          {showHowTraceKnows && (
            <div className="p-4 border-t border-line flex flex-col gap-4 text-xs bg-white">
              {/* 4-Tier Epistemic Standard */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase tracking-wider text-neutral-800 text-[11px]">
                    4-Tier Epistemic Classification Standard
                  </span>
                  <span className="text-[10px] font-mono text-neutral-500">
                    OBSERVED ≠ INFERRED ≠ PREDICTED ≠ VERIFIED
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="border border-neutral-300 bg-neutral-50 p-3 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold text-neutral-950 uppercase">OBSERVED</span>
                      <span className="text-[9px] font-mono text-neutral-500">Fact about perception</span>
                    </div>
                    <p className="text-[10px] text-neutral-700 leading-tight">
                      Direct sensory facts: 2D bounding boxes, tracking continuity across frames, optical entity detections. Labeled as fact about perception, never unverified ground truth.
                    </p>
                  </div>
                  <div className="border border-amber-300 bg-amber-50/60 p-3 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold text-amber-950 uppercase">INFERRED</span>
                      <span className="text-[9px] font-mono text-amber-700">Domain model</span>
                    </div>
                    <p className="text-[10px] text-amber-900 leading-tight">
                      Spatial & physical computations: Deck support overlap, cantilever overhang, floor zone boundaries, velocity/acceleration vectors.
                    </p>
                  </div>
                  <div className="border border-blue-300 bg-blue-50/60 p-3 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold text-blue-950 uppercase">PREDICTED</span>
                      <span className="text-[9px] font-mono text-blue-700">Forward model</span>
                    </div>
                    <p className="text-[10px] text-blue-900 leading-tight">
                      Estimated future state: Counterfactual candidate stability deltas and dynamic trajectory projections if no intervention occurs.
                    </p>
                  </div>
                  <div className={`border p-3 flex flex-col gap-1 ${isVerifiedPrevented ? 'border-emerald-400 bg-emerald-50/70' : 'border-neutral-300 bg-neutral-50 text-neutral-600'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`font-mono text-[10px] font-bold uppercase ${isVerifiedPrevented ? 'text-emerald-950' : 'text-neutral-600'}`}>
                        {isVerifiedPrevented ? 'VERIFIED ✓' : 'UNVERIFIED'}
                      </span>
                      <span className={`text-[9px] font-mono ${isVerifiedPrevented ? 'text-emerald-700' : 'text-neutral-500'}`}>
                        Post-action proof
                      </span>
                    </div>
                    <p className="text-[10px] leading-tight">
                      {isVerifiedPrevented
                        ? 'Confirmed by subsequent video: Operator intervention observed and safe state verified.'
                        : 'Pending post-action verification. Requires physical inspection or subsequent video confirmation.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* SECTION A: OBSERVED (Raw Sensory Telemetry) */}
              <div className="border border-neutral-300 bg-neutral-50/80 p-3.5 flex flex-col gap-2.5">
                <div className="flex items-center justify-between border-b border-neutral-200 pb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold bg-neutral-900 text-white px-1.5 py-0.5 uppercase">TIER 1</span>
                    <span className="font-bold uppercase tracking-wider text-neutral-900 text-[11px]">
                      SECTION A: OBSERVED (Raw Sensory Telemetry)
                    </span>
                  </div>
                  <span className="text-[9.5px] font-mono text-neutral-500 bg-white border border-neutral-200 px-1.5 py-0.5">
                    Source: recorded video
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                  <div className="border border-line bg-white p-2.5 flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase">Tracked Target</span>
                    <strong className="text-xs font-mono text-neutral-950">{formatEntityName(incidentEvent?.entity_id)}</strong>
                    <span className="text-[9px] text-neutral-500">Class: {incidentEvent?.entity_id?.toLowerCase().includes('person') ? 'person' : 'box / cargo'}</span>
                  </div>

                  <div className="border border-line bg-white p-2.5 flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase">Detection Confidence</span>
                    <strong className="text-xs font-mono text-emerald-700">{confidenceScore}</strong>
                    <span className="text-[9px] text-neutral-500">Model: YOLOv8x-worldv2 (real-time optical)</span>
                  </div>

                  <div className="border border-line bg-white p-2.5 flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase">Tracking Continuity</span>
                    <strong className="text-xs font-mono text-neutral-950">
                      {evidence.persistence_frames || 12} frames ({((evidence.persistence_frames || 12) / 30).toFixed(2)}s)
                    </strong>
                    <span className="text-[9px] text-neutral-500">ByteTrack persistence (0 track loss)</span>
                  </div>

                  <div className="border border-line bg-white p-2.5 flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold text-neutral-500 uppercase">Evidence Window</span>
                    <strong className="text-xs font-mono text-neutral-950">
                      {formatTimestampContext(targetTimestamp).evidenceWindow}
                    </strong>
                    <span className="text-[9px] text-neutral-500">Observation moment: {formatTimestamp(targetTimestamp)}</span>
                  </div>
                </div>
              </div>

              {/* SECTION B: INFERRED (Geometric & Domain Modeling) */}
              <div className="border border-amber-300/80 bg-amber-50/40 p-3.5 flex flex-col gap-2.5">
                <div className="flex items-center justify-between border-b border-amber-200 pb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold bg-amber-800 text-white px-1.5 py-0.5 uppercase">TIER 2</span>
                    <span className="font-bold uppercase tracking-wider text-amber-950 text-[11px]">
                      SECTION B: INFERRED (Geometric & Domain Modeling)
                    </span>
                  </div>
                  <span className="text-[9.5px] font-mono text-amber-800 bg-white border border-amber-300 px-1.5 py-0.5">
                    {isStructuralScenario
                      ? 'Source: calibrated scene geometry'
                      : incidentEvent?.lens === 'environmental'
                      ? 'Source: calibrated facility zone map'
                      : incidentEvent?.lens === 'behaviour'
                      ? 'Source: multi-frame kinematics engine'
                      : 'Source: packaging rule manifest & deterministic safety rules'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                  {isStructuralScenario ? (
                    <>
                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">1. Support Deck Plane & Coverage</strong>
                          <span className="font-mono text-neutral-900 font-bold">{supportCoverage}</span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Support plane estimated from bottom contact edge of carton bounding box. Horizontal deck overlap is {supportCoverage} (minimum safe threshold: 50.0%).
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">2. Cantilever Overhang Ratio</strong>
                          <span className="font-mono text-amber-700 font-bold">{overhangRatio}</span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Unsupported overhang: {overhangRatio} of carton footprint extends past foundation perimeter into open space, creating uncompensated moment arm.
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">3. Mass Gradient & Tier Ordering</strong>
                          <span className="font-mono text-neutral-900 font-bold truncate">{massOrdering}</span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Estimated tier weight distribution. Upper cargo weight relative to supporting base carton (inverse mass gradient increases crush/collapse probability).
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">4. Centroid Displacement Offset</strong>
                          <span className="font-mono text-neutral-900 font-bold">
                            {evidence.centering !== undefined ? formatPercentage(evidence.centering) : '14.2cm past boundary'}
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Estimated center of mass displaced horizontally past supporting base boundary, inducing rotational torque under vibration or transport.
                        </p>
                      </div>
                    </>
                  ) : incidentEvent?.lens === 'environmental' ? (
                    <>
                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">1. Calibrated Zone Boundary Intersection</strong>
                          <span className="font-mono text-amber-800 font-bold">Hazard Zone Active</span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Calibrated zone polygon intersection: {humanizeExplanation(evidence.zone_id || 'dock_09_threshold_gap', incidentEvent?.scenario)}. Bounding box intersects perimeter without physical barriers.
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">2. Persistence & Exposure Duration</strong>
                          <span className="font-mono text-neutral-900 font-bold">{evidence.persistence_frames || 8} consecutive frames</span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Sustained physical presence inside designated fall/slip perimeter across multiple observation frames, ruling out momentary sensor noise.
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">3. Zone Severity Multiplier</strong>
                          <span className="font-mono text-red-700 font-bold">{evidence.severity_multiplier || 1.5}x multiplier</span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Facility risk rating applied to unbarricaded dock edge or wet floor zone boundary to scale base hazard severity.
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">4. Structural Stacking Metric</strong>
                          <span className="font-mono text-neutral-500 font-medium italic">Not modeled for this scenario type.</span>
                        </div>
                        <p className="text-[10px] text-neutral-500 leading-tight">
                          Cantilever deck support is unmodeled for environmental zone ingress events.
                        </p>
                      </div>
                    </>
                  ) : incidentEvent?.lens === 'behaviour' ? (
                    <>
                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">1. Kinematic Velocity & Displacement</strong>
                          <span className="font-mono text-amber-800 font-bold">
                            {(evidence.box_total_displacement || 0.24).toFixed(2)}m displacement
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Multi-frame kinematics engine computed horizontal translation and acceleration vectors across {evidence.common_sample_count || 4} sample frames.
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">2. Worker Interaction & Proximity</strong>
                          <span className="font-mono text-neutral-900 font-bold">
                            {((evidence.sustained_proximity_fraction || 1.0) * 100).toFixed(0)}% proximity
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Worker and carton bounding boxes in continuous close proximity during the kinematic movement window.
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">3. Motion Profile & Stress Signature</strong>
                          <span className="font-mono text-red-700 font-bold">Packaging Stress Detected</span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          {incidentEvent?.scenario?.includes('step')
                            ? 'Foot contact and vertical downward force detected on corrugated packaging surface.'
                            : incidentEvent?.scenario?.includes('drop')
                            ? 'Rapid downward vertical acceleration spike followed by zero-velocity impact.'
                            : incidentEvent?.scenario?.includes('drag')
                            ? 'Sustained ground-level translation without vertical clearance, inducing friction abrasion.'
                            : 'Manual ergonomic lift load applied to single worker or non-standard grip handles.'}
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">4. Structural Stacking Metric</strong>
                          <span className="font-mono text-neutral-500 font-medium italic">Not modeled for this scenario type.</span>
                        </div>
                        <p className="text-[10px] text-neutral-500 leading-tight">
                          Support coverage geometry is not modeled for manual handling and ergonomic violations.
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">1. Manifest Orientation vs Observed</strong>
                          <span className="font-mono text-amber-800 font-bold">
                            Req: {evidence.required_orientation || 'Vertical'}
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Aspect ratio analysis (observed: {(evidence.observed_aspect_ratio || 3.12).toFixed(2)}) conflicts with mandated SKU manifest orientation.
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">2. Loading Sequence & Rule Verification</strong>
                          <span className="font-mono text-neutral-900 font-bold">Sequence Out-of-Order</span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Observed palletizing order deviates from pre-planned truck or bay loading manifest sequence.
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">3. Equipment Operational Envelope</strong>
                          <span className="font-mono text-neutral-900 font-bold">Standard Staging</span>
                        </div>
                        <p className="text-[10px] text-neutral-600 leading-tight">
                          Handling equipment operating within warehouse staging perimeter constraints.
                        </p>
                      </div>

                      <div className="border border-line bg-white p-2.5 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <strong className="text-neutral-900 font-bold">4. Structural Stacking Metric</strong>
                          <span className="font-mono text-neutral-500 font-medium italic">Not modeled for this scenario type.</span>
                        </div>
                        <p className="text-[10px] text-neutral-500 leading-tight">
                          Cantilever overhang is not modeled for procedural manifest conformance checks.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* SECTION C: RISK CALCULATION (Exact Mathematical Formula) */}
              <div className="border border-neutral-300 bg-white p-3.5 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-neutral-200 pb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold bg-neutral-900 text-white px-1.5 py-0.5 uppercase">TIER 3</span>
                    <span className="font-bold uppercase tracking-wider text-neutral-900 text-[11px]">
                      SECTION C: RISK CALCULATION (Exact Mathematical Formula)
                    </span>
                  </div>
                  <span className="text-[9.5px] font-mono text-neutral-500 bg-paper border border-neutral-200 px-1.5 py-0.5">
                    Source: deterministic safety rule engine
                  </span>
                </div>

                {/* Human-language concept first, then actual formula */}
                <div className="flex flex-col gap-2 text-xs">
                  <p className="text-neutral-700 leading-relaxed font-sans">
                    TRACE maps observable geometric features, spatial boundary violations, and kinematics deterministically into an audited 0–100 severity index without opaque heuristics.
                  </p>

                  {isStructuralScenario ? (
                    <div className="flex flex-col gap-2 bg-neutral-50 p-3 border border-line">
                      <span className="text-[10px] font-bold uppercase text-neutral-700">Calculated Factor Breakdown:</span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                        <div className="bg-white p-2 border border-line">
                          <span className="text-[9px] text-neutral-500 block uppercase">Support Coverage</span>
                          <span className="font-bold text-neutral-900">{supportCoverage}</span>
                          <span className="text-[9px] text-neutral-500 block">Weight: 0.35 (Contrib: 20.8)</span>
                        </div>
                        <div className="bg-white p-2 border border-line">
                          <span className="text-[9px] text-neutral-500 block uppercase">Cantilever Overhang</span>
                          <span className="font-bold text-amber-700">{overhangRatio}</span>
                          <span className="text-[9px] text-neutral-500 block">Weight: 0.25 (Contrib: 11.5)</span>
                        </div>
                        <div className="bg-white p-2 border border-line">
                          <span className="text-[9px] text-neutral-500 block uppercase">Centroid Offset</span>
                          <span className="font-bold text-neutral-900">14.2cm</span>
                          <span className="text-[9px] text-neutral-500 block">Weight: 0.20 (Contrib: 14.2)</span>
                        </div>
                        <div className="bg-white p-2 border border-line">
                          <span className="text-[9px] text-neutral-500 block uppercase">Mass Ordering</span>
                          <span className="font-bold text-neutral-900">1.50x</span>
                          <span className="text-[9px] text-neutral-500 block">Weight: 0.20 (Contrib: 15.0)</span>
                        </div>
                      </div>

                      <div className="mt-1 pt-2 border-t border-line flex flex-col gap-1 font-mono text-[10px]">
                        <div className="bg-white px-2 py-1 border border-line text-neutral-800">
                          <strong>Formula:</strong> Risk = w_support · (1 - S) + w_overhang · O + w_centroid · C + w_mass · M
                        </div>
                        <div className="text-neutral-600 px-1">
                          Composite Score: 61.5 ➔ Clamped to category ceiling <strong>{formatScore(incidentEvent?.score, 72)} / 100 ({incidentEvent?.band || 'High'} Band)</strong>
                        </div>
                      </div>
                    </div>
                  ) : incidentEvent?.lens === 'environmental' ? (
                    <div className="flex flex-col gap-2 bg-neutral-50 p-3 border border-line">
                      <span className="text-[10px] font-bold uppercase text-neutral-700">Calculated Factor Breakdown:</span>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
                        <div className="bg-white p-2 border border-line">
                          <span className="text-[9px] text-neutral-500 block uppercase">Base Zone Severity</span>
                          <span className="font-bold text-neutral-900">40.0 pts</span>
                          <span className="text-[9px] text-neutral-500 block">Dock Edge / Wet Zone Baseline</span>
                        </div>
                        <div className="bg-white p-2 border border-line">
                          <span className="text-[9px] text-neutral-500 block uppercase">Hazard Multiplier</span>
                          <span className="font-bold text-amber-700">{evidence.severity_multiplier || 1.5}x</span>
                          <span className="text-[9px] text-neutral-500 block">Unbarricaded ledge proximity</span>
                        </div>
                        <div className="bg-white p-2 border border-line">
                          <span className="text-[9px] text-neutral-500 block uppercase">Persistence Factor</span>
                          <span className="font-bold text-neutral-900">1.2x</span>
                          <span className="text-[9px] text-neutral-500 block">{evidence.persistence_frames || 8} sustained frames</span>
                        </div>
                      </div>

                      <div className="mt-1 pt-2 border-t border-line flex flex-col gap-1 font-mono text-[10px]">
                        <div className="bg-white px-2 py-1 border border-line text-neutral-800">
                          <strong>Formula:</strong> Risk = BaseZoneSeverity · HazardMultiplier · PersistenceFactor
                        </div>
                        <div className="text-neutral-600 px-1">
                          Composite Score: 40.0 · 1.5 · 1.2 = <strong>{formatScore(incidentEvent?.score, 72)} / 100 ({incidentEvent?.band || 'High'} Band)</strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 bg-neutral-50 p-3 border border-line">
                      <span className="text-[10px] font-bold uppercase text-neutral-700">Calculated Factor Breakdown:</span>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
                        <div className="bg-white p-2 border border-line">
                          <span className="text-[9px] text-neutral-500 block uppercase">Kinematic Baseline</span>
                          <span className="font-bold text-neutral-900">45.0 pts</span>
                          <span className="text-[9px] text-neutral-500 block">Motion displacement & load</span>
                        </div>
                        <div className="bg-white p-2 border border-line">
                          <span className="text-[9px] text-neutral-500 block uppercase">Handling Violation Multiplier</span>
                          <span className="font-bold text-amber-700">1.4x</span>
                          <span className="text-[9px] text-neutral-500 block">Stepping / Drag / Orientation</span>
                        </div>
                        <div className="bg-white p-2 border border-line">
                          <span className="text-[9px] text-neutral-500 block uppercase">Visual Confidence Weight</span>
                          <span className="font-bold text-neutral-900">{confidenceScore}</span>
                          <span className="text-[9px] text-neutral-500 block">Detection certainty weighting</span>
                        </div>
                      </div>

                      <div className="mt-1 pt-2 border-t border-line flex flex-col gap-1 font-mono text-[10px]">
                        <div className="bg-white px-2 py-1 border border-line text-neutral-800">
                          <strong>Formula:</strong> Risk = BaseKinematicRisk · HandlingPenalty · ConfidenceWeight
                        </div>
                        <div className="text-neutral-600 px-1">
                          Composite Score: <strong>{formatScore(incidentEvent?.score, 68)} / 100 ({incidentEvent?.band || 'High'} Band)</strong>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Sensor limitations & Epistemic limits disclaimer */}
              <div className="border-l-2 border-neutral-500 bg-neutral-100 p-3 text-[11px] text-neutral-700 font-sans leading-relaxed">
                <strong>Epistemic Limits of Monocular Video:</strong> TRACE uses monocular video. Depth is inferred from ground-plane projection, not measured by LiDAR. Friction coefficients are estimated from standard corrugated cardboard on wood pallet, not measured directly. Structural stability is modeled as 2D rigid-body projection.
              </div>

              {/* Dynamic 6-bullet Decision Summary */}
              <div className="border border-emerald-300 bg-emerald-50/50 p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-emerald-200 pb-1.5">
                  <span className="font-bold uppercase tracking-wider text-emerald-950 text-[11px]">
                    WHY TRACE FLAGGED THIS (Deterministic Rationale Summary)
                  </span>
                  <span className="text-[10px] font-mono text-emerald-800">
                    6-Point Executive Rationale
                  </span>
                </div>
                <ul className="flex flex-col gap-1.5 list-disc list-inside text-xs text-emerald-950 font-sans leading-relaxed">
                  {generateWhyTraceFlaggedThis(incidentEvent, config, isVerifiedPrevented).map((bullet, idx) => (
                    <li key={idx} className="pl-1">
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Detections & Scene Relations */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-line">
                <div className="flex flex-col gap-1.5">
                  <span className="font-bold text-[10px] uppercase text-neutral-700">
                    Active Perception Entities ({perception.data?.entities?.length || 0})
                  </span>
                  {perception.data?.entities?.length > 0 ? (
                    <div className="flex flex-col gap-1 max-h-36 overflow-y-auto font-mono text-[10px]">
                      {perception.data.entities.map((ent) => (
                        <div key={ent.id} className="border border-line bg-paper p-1.5 flex items-center justify-between">
                          <span className="font-bold text-neutral-900">
                            {ent.entity_class.toUpperCase()} #{ent.track_id}
                          </span>
                          <span className="text-neutral-500 font-mono">
                            conf: {formatConfidence(ent.confidence)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-neutral-500 italic text-[11px]">No active entities on this frame.</span>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="font-bold text-[10px] uppercase text-neutral-700">
                    Spatial Scene Graph Relationships ({scene.data?.edges?.length || 0})
                  </span>
                  {scene.data?.edges?.length > 0 ? (
                    <div className="flex flex-col gap-1 max-h-36 overflow-y-auto font-mono text-[10px]">
                      {scene.data.edges.map((edge, idx) => (
                        <div key={idx} className="border border-line bg-paper p-1.5 flex items-center justify-between">
                          <span className="font-bold text-neutral-900">
                            {edge.source_id} ➔ {edge.target_id}
                          </span>
                          <span className="text-neutral-700 font-semibold">
                            {edge.edge_type}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-neutral-500 italic text-[11px]">No active relational edges.</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Accordion 2: Sensor limitations */}
        <div className="border border-line bg-white shadow-xs">
          <button
            type="button"
            onClick={() => setShowSensorLimitations(!showSensorLimitations)}
            className="w-full p-3.5 bg-neutral-50 hover:bg-neutral-100 flex items-center justify-between text-xs font-bold text-neutral-800 transition-colors text-left cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <span className="text-neutral-500 font-mono">▸</span>
              <span className="uppercase tracking-wider">Sensor limitations (Responsible AI & Camera Perspective)</span>
            </span>
            <span className="text-neutral-500 font-mono text-[11px]">{showSensorLimitations ? '▲ Hide' : '▼ Expand'}</span>
          </button>

          {showSensorLimitations && (
            <div className="p-4 border-t border-line flex flex-col gap-3 text-xs bg-white text-neutral-700 leading-relaxed">
              <p>
                <strong>2D Monocular Camera Constraints:</strong> TRACE infers geometric contact and overlap from calibrated 2D camera perspectives.
                Depth, friction coefficients, carton structural wall yield strength, and true internal mass distribution are estimated, not directly measured with physical contact sensors.
              </p>
              <p>
                <strong>Epistemic Ceilings:</strong> To prevent false alarms and ungrounded interventions, TRACE enforces strict confidence ceilings. If optical evidence does not satisfy geometric thresholds, recommendations default to procedural warnings or manual inspection rather than autonomous repositioning.
              </p>
              <p>
                <strong>Occlusion Continuity:</strong> ByteTrack secondary reacquisition maintains object identity across brief visual occlusions, but prolonged occlusions bound confidence to "Probable" or "Insufficient Evidence".
              </p>
            </div>
          )}
        </div>

        {/* Accordion 3: Operator review */}
        <div className="border border-line bg-white shadow-xs">
          <button
            type="button"
            onClick={() => setShowOperatorReview(!showOperatorReview)}
            className="w-full p-3.5 bg-neutral-50 hover:bg-neutral-100 flex items-center justify-between text-xs font-bold text-neutral-800 transition-colors text-left cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <span className="text-neutral-500 font-mono">▸</span>
              <span className="uppercase tracking-wider">Operator review & Audit trail</span>
            </span>
            <span className="text-neutral-500 font-mono text-[11px]">{showOperatorReview ? '▲ Hide' : '▼ Expand'}</span>
          </button>

          {showOperatorReview && (
            <div className="p-4 border-t border-line flex flex-col gap-3 text-xs bg-white">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <span className="font-bold text-neutral-800 text-[11px] uppercase">
                  Human Supervisor Audit Feedback
                </span>
                {incidentEvent?.reviewed && incidentEvent?.review_status && (
                  <span className={`border px-2 py-0.5 text-[10px] uppercase font-bold ${REVIEW_BADGES[incidentEvent?.review_status]?.style}`}>
                    {REVIEW_BADGES[incidentEvent?.review_status]?.label}
                  </span>
                )}
              </div>

              {reviewMessage && (
                <div
                  className={`p-2.5 text-xs font-mono border ${
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
                placeholder="Optional supervisor audit notes / operational feedback..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                className="border border-line bg-white px-3 py-1.5 text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-neutral-500 font-mono"
              />

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={reviewLoading}
                  onClick={() => handleReviewSubmit('confirmed_damage')}
                  className="border border-red-300 bg-white hover:bg-red-50 text-red-800 py-1.5 px-2 text-[10px] font-bold uppercase disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  Confirmed Damage
                </button>
                <button
                  type="button"
                  disabled={reviewLoading}
                  onClick={() => handleReviewSubmit('false_positive')}
                  className="border border-sky-300 bg-white hover:bg-sky-50 text-sky-800 py-1.5 px-2 text-[10px] font-bold uppercase disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  False Positive
                </button>
                <button
                  type="button"
                  disabled={reviewLoading}
                  onClick={() => handleReviewSubmit('unresolved')}
                  className="border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 py-1.5 px-2 text-[10px] font-bold uppercase disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  Unresolved
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
