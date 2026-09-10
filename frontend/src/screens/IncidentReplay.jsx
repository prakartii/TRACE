import { useEffect, useRef, useState, useCallback } from 'react'
import { ArrowLeft, ArrowRight, FlaskConical, Play } from 'lucide-react'
import { getEvent, listEvents, submitReview } from '../api/events.js'
import { getEventOutcome, verifyEventOutcome } from '../api/measurement.js'
import { getActionPlan } from '../api/actions.js'
import { getEntities, getScene, getWhatIf, listVideos, streamUrl } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import HypotheticalOverlay from '../components/video/HypotheticalOverlay.jsx'
import PerceptionOverlay from '../components/video/PerceptionOverlay.jsx'
import FaceRedactionOverlay from '../components/video/FaceRedactionOverlay.jsx'
import SceneOverlay from '../components/video/SceneOverlay.jsx'
import VideoViewport from '../components/video/VideoViewport.jsx'
import WhatIfPanel from '../components/video/WhatIfPanel.jsx'
import { useOverlayData } from '../hooks/useOverlayData.js'
import { useIntervention } from '../context/InterventionContext.jsx'
import InterventionStatusChip from '../components/intervention/InterventionStatusChip.jsx'
import WorkflowNav from '../components/WorkflowNav.jsx'

import {
  getScenarioConfig,
  getVideoScenarioInfo,
  resolveIncidentTitle,
  DEMO_PRESETS,
  formatTimestamp,
  formatTimestampContext,
  formatEvidenceKey,
  formatEvidenceValue,
  telemetryEntries,
  formatEventRef,
} from '../lib/scenarios.js'
import SupervisorRuleNotice from '../components/SupervisorRuleNotice.jsx'
import {
  formatConfidence,
  formatScore,
  formatPercentage,
  formatEntityName,
  humanizeExplanation,
  humanizeAction,
  humanizeTitle,
  generateWhyTraceFlaggedThis,
} from '../lib/format.js'

const BAND_STYLE = {
  Critical: 'border-danger/40 bg-danger/10 text-danger',
  High: 'border-signal/40 bg-signal/10 text-[#8a5f00]',
  Medium: 'border-steel/40 bg-steel/10 text-steel',
  Low: 'border-line-strong bg-paper text-ink-soft',
}

const OUTCOME_BADGES = {
  prevented: {
    label: 'prevented',
    sublabel: 'safe intervention verified',
    style: 'border-ok/40 bg-ok/10 text-ok',
    dot: 'bg-ok',
  },
  near_miss: {
    label: 'near-miss',
    sublabel: 'belated / marginal action',
    style: 'border-signal/40 bg-signal/10 text-[#8a5f00]',
    dot: 'bg-signal',
  },
  outcome_unclear: {
    label: 'outcome unclear',
    sublabel: 'no post-action evidence',
    style: 'border-line bg-paper text-ink-soft',
    dot: 'bg-line-strong',
  },
  confirmed_damage: {
    label: 'confirmed damage',
    sublabel: 'human review override',
    style: 'border-danger/40 bg-danger/10 text-danger',
    dot: 'bg-danger',
  },
}

const REVIEW_BADGES = {
  confirmed_damage: { label: 'confirmed damage', style: 'border-danger/40 bg-danger/10 text-danger' },
  false_positive: { label: 'false positive', style: 'border-steel/40 bg-steel/10 text-steel' },
  unresolved: { label: 'unresolved / pending', style: 'border-signal/40 bg-signal/10 text-[#8a5f00]' },
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
  const { activeAlerts, setSelectedAlert } = useIntervention()


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

  const [overlayEnabled, setOverlayEnabled] = useState(true)
  const [sceneEnabled, setSceneEnabled] = useState(false)
  const [modelName, setModelName] = useState('pilot')

  const [recentEvents, setRecentEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(replayTarget?.eventId || null)
  const [incidentEvent, setIncidentEvent] = useState(replayTarget?.event || null)
  const [targetTimestamp, setTargetTimestamp] = useState(replayTarget?.timestamp || 0)
  const [incidentLoading, setIncidentLoading] = useState(false)
  const [incidentError, setIncidentError] = useState(null)

  const [whatIfSimulation, setWhatIfSimulation] = useState(null)
  const [whatIfLoading, setWhatIfLoading] = useState(false)
  const [whatIfError, setWhatIfError] = useState(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState(null)

  const [outcomeMeasurement, setOutcomeMeasurement] = useState(null)
  const [outcomeLoading, setOutcomeLoading] = useState(false)
  const [outcomeVerifying, setOutcomeVerifying] = useState(false)
  const [outcomeError, setOutcomeError] = useState(null)
  const [verificationWindow, setVerificationWindow] = useState(5.0)

  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewMessage, setReviewMessage] = useState(null)

  // Safe Action Plan state (Feature 3)
  const [safePlan, setSafePlan] = useState(null)
  const [safePlanLoading, setSafePlanLoading] = useState(false)

  // Progressive Disclosure Accordions State
  const [showHowTraceKnows, setShowHowTraceKnows] = useState(false)
  const [showSensorLimitations, setShowSensorLimitations] = useState(false)
  const [showOperatorReview, setShowOperatorReview] = useState(false)

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

  // 2. Load recent events for quick switcher (all events)
  useEffect(() => {
    let active = true
    listEvents({ limit: 300, order: 'desc' })
      .then((data) => {
        if (!active) return
        setRecentEvents(data || [])

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
      active = true
    }
  }, [selectedEventId, replayTarget])

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

    setSafePlanLoading(true)
    getActionPlan(selectedEventId)
      .then((plan) => {
        if (active) setSafePlan(plan)
      })
      .catch(() => {
        if (active) setSafePlan(null)
      })
      .finally(() => {
        if (active) setSafePlanLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedEventId])

  const targetVideoId =
    incidentEvent?.video_id ||
    (selectedEventId === replayTarget?.eventId ? replayTarget?.videoId : null)
  const selectedVideo = resolveVideoRecord(videos, targetVideoId)
  const videoNotFound = Boolean(targetVideoId && !videosLoading && !selectedVideo)

  const perception = useOverlayData(getEntities, true, selectedVideo?.id, currentTime, modelName)
  const scene = useOverlayData(getScene, sceneEnabled, selectedVideo?.id, currentTime, modelName)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return undefined
    setVideoBoxSize({ width: el.clientWidth, height: el.clientHeight })
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setVideoBoxSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [selectedVideo])

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

  const handleLoadedMetadata = (event) => {
    const d = event.currentTarget.duration
    setDuration(d)
    if (!hasSeekedToInitial && targetTimestamp > 0) {
      seekToTimestamp(targetTimestamp)
      setHasSeekedToInitial(true)
    }
  }

  useEffect(() => {
    if (targetTimestamp !== undefined && targetTimestamp !== null && duration > 0) {
      seekToTimestamp(targetTimestamp)
    }
  }, [targetTimestamp, selectedVideo?.id, duration, seekToTimestamp])

  const handleTimeUpdate = (event) => {
    const t = event.currentTarget.currentTime
    setCurrentTime(t)
    perception.fetchThrottled(t)
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

  const handleReviewSubmit = async (statusValue) => {
    if (!selectedEventId) return
    setReviewLoading(true)
    setReviewMessage(null)
    try {
      const updated = await submitReview(selectedEventId, statusValue, reviewNotes.trim() || null)
      setIncidentEvent(updated)
      setReviewMessage({
        type: 'success',
        text: `review recorded as: ${statusValue.replace(/_/g, ' ')}`,
      })
      setReviewNotes('')
    } catch (err) {
      setReviewMessage({ type: 'error', text: err.message || 'Failed to submit review feedback.' })
    } finally {
      setReviewLoading(false)
    }
  }

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
      const preset = DEMO_PRESETS.find((d) => d.id === targetId)
      if (preset) {
        setTargetTimestamp(preset.timestamp)
        setIncidentEvent({
          event_id: preset.id,
          video_id: preset.videoId,
          timestamp: preset.timestamp,
          scenario: preset.scenario,
          band: 'High',
        })
        setHasSeekedToInitial(false)
      } else {
        setIncidentEvent(null)
      }
    }
  }

  const SUPPORTED_WHAT_IF_SCENARIOS = [
    'heavy_on_light_stacking',
    'dropping_or_throwing_precursor',
    'carton_drop',
    'dragging_precursor',
    'rolling_precursor',
    'straps_as_handles',
    'stepping_on_carton',
    'stepping_on_carton_precursor',
    'wrong_product_orientation',
    'box_overhang',
    'pallet_overhang',
    'entity_in_dock_edge_zone',
    'entity_in_wet_floor_zone',
    'unplanned_loading_sequence',
    'solo_heavy_handling',
    'wrong_equipment_usage',
    'unsupported_bending_placement',
  ]

  const isWhatIfEligible = Boolean(
    incidentEvent &&
      SUPPORTED_WHAT_IF_SCENARIOS.includes(incidentEvent.scenario) &&
      incidentEvent.status !== 'insufficient_evidence'
  )

  const activeCandidate =
    whatIfSimulation?.alternatives?.find((c) => c.id === selectedCandidateId) ||
    whatIfSimulation?.alternatives?.[0] ||
    null

  const config = getScenarioConfig(incidentEvent?.scenario)
  const videoInfo = getVideoScenarioInfo(incidentEvent?.video_id || selectedVideo?.id, incidentEvent?.scenario)
  const title = humanizeTitle(resolveIncidentTitle(incidentEvent) || config.title || 'Recorded operational hazard', incidentEvent?.scenario)

  const activeIntervention = (incidentEvent && activeAlerts) ? activeAlerts.find(
    (a) => a.event_id === incidentEvent.event_id || (a.video_id === incidentEvent.video_id && a.scenario === incidentEvent.scenario)
  ) : null


  const rawDelta = currentTime - targetTimestamp
  const timeDelta = Math.abs(rawDelta) < 0.05 ? 0 : rawDelta
  const isNearBookmark = Math.abs(currentTime - targetTimestamp) <= 0.3

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

  // Only the recorded outcome may call something "prevented" — never the event id
  // (CLAUDE.md §15: all three conditions must actually hold).
  const isVerifiedPrevented = outcomeMeasurement?.classification === 'prevented'

  // The real 3-condition check, in condition order (ARCHITECTURE.md §13 beat 3).
  const threeConditions = Object.values(outcomeMeasurement?.three_condition_check || {})
    .filter((c) => c && typeof c === 'object' && c.condition_number)
    .sort((a, b) => a.condition_number - b.condition_number)

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* 5-step safety workflow banner */}
      <WorkflowNav
        currentStep={3}
        navigateTo={navigateTo}
        context={{
          eventId: incidentEvent?.event_id || selectedEventId,
          videoId: incidentEvent?.video_id || selectedVideo?.id,
          timestamp: targetTimestamp,
          event: incidentEvent,
        }}
      />

      {/* Header bar */}
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2 text-caption text-ink-soft">
            <button
              type="button"
              onClick={() => navigateTo('Incidents')}
              className="inline-flex items-center gap-1 font-medium hover:text-ink cursor-pointer"
            >
              <ArrowLeft size={13} />
              Active Hazards
            </button>
            <span>/</span>
            <span className="font-semibold text-ink">Step 3: Forensic Replay</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-ink">
              Incident Evidence Replay
            </h1>
            <span className="border border-line bg-paper px-2 py-0.5 font-mono text-caption text-ink font-semibold">
              Event #{incidentEvent?.event_id || selectedEventId || '—'}
            </span>
            <span className={`border px-2.5 py-0.5 text-caption font-bold uppercase tracking-wider ${BAND_STYLE[incidentEvent?.band] || BAND_STYLE.High}`}>
              {incidentEvent?.band || 'High'} Risk · Score {formatScore(incidentEvent?.score)}/100
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-caption font-medium text-ink-soft">Select Incident:</label>
          <select
            value={incidentEvent?.event_id || selectedEventId || ''}
            onChange={(e) => handleSelectAnotherEvent(e.target.value)}
            className="border border-line bg-surface px-2.5 py-1.5 text-small text-ink focus:border-ink font-medium cursor-pointer"
          >
            {recentEvents.map((ev) => (
              <option key={ev.event_id} value={ev.event_id}>
                #{ev.event_id} · {humanizeTitle(resolveIncidentTitle(ev), ev.scenario)} ({getVideoScenarioInfo(ev.video_id, ev.scenario).cameraName})
              </option>
            ))}
          </select>
        </div>
      </section>

      {incidentLoading && !incidentEvent && (
        <div className="flex items-center gap-3 border border-line bg-surface p-8">
          <span className="h-4 w-4 animate-spin motion-reduce:animate-none border-2 border-ink border-t-transparent" />
          <span className="text-small font-medium text-ink">
            loading forensic replay {selectedEventId ? `(event #${selectedEventId})` : ''}…
          </span>
        </div>
      )}

      {!incidentLoading && (!incidentEvent || incidentError) && (
        <div className="border border-danger bg-danger/5 p-4 text-small text-danger">
          <p className="font-semibold">incident context unavailable</p>
          <p className="mt-1">The requested incident record (event #{selectedEventId}) could not be verified against the loaded video feed.</p>
          <button
            type="button"
            onClick={() => handleSelectAnotherEvent(73)}
            className="mt-3 border border-danger px-3 py-1 text-caption font-medium hover:bg-danger/10 cursor-pointer"
          >
            load canonical incident (event #73)
          </button>
        </div>
      )}

      {/* Main Forensic Workspace */}
      {incidentEvent && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          {/* Left Column: Video Evidence HERO (7 cols) */}
          <div className="flex flex-col gap-4 lg:col-span-7">
            {/* Control Bar */}
            <div className="flex flex-col gap-2 border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint mr-1">
                    Timeline:
                  </span>
                  <button
                    type="button"
                    onClick={() => seekToTimestamp(Math.max(0, targetTimestamp - 3.0))}
                    className={`inline-flex items-center gap-1 border px-2.5 py-1 text-caption font-medium transition-colors cursor-pointer ${
                      currentTime < targetTimestamp - 1.0
                        ? 'border-ink bg-ink text-paper font-semibold'
                        : 'border-line bg-paper text-ink hover:border-ink'
                    }`}
                    title="Jump to 3 seconds before hazard occurred"
                  >
                    1. Before (-3s)
                  </button>

                  <button
                    type="button"
                    onClick={() => seekToTimestamp(targetTimestamp)}
                    className={`inline-flex items-center gap-1 border px-2.5 py-1 text-caption font-bold transition-colors cursor-pointer ${
                      isNearBookmark
                        ? 'border-signal bg-signal text-paper'
                        : 'border-line bg-paper text-ink hover:border-ink'
                    }`}
                    title="Jump to the exact detected hazard frame"
                  >
                    <Play size={10} />
                    2. Hazard Detected ({formatTimestamp(targetTimestamp)})
                  </button>

                  <button
                    type="button"
                    onClick={() => seekToTimestamp(Math.min(duration || 9999, targetTimestamp + 3.0))}
                    className={`inline-flex items-center gap-1 border px-2.5 py-1 text-caption font-medium transition-colors cursor-pointer ${
                      currentTime > targetTimestamp + 1.0
                        ? 'border-ink bg-ink text-paper font-semibold'
                        : 'border-line bg-paper text-ink hover:border-ink'
                    }`}
                    title="Jump to 3 seconds after hazard occurred"
                  >
                    3. Incident Outcome (+3s)
                  </button>
                </div>

                <div className="flex items-center gap-2.5">
                  <label className="flex cursor-pointer items-center gap-1 text-caption text-ink-soft hover:text-ink">
                    <input
                      type="checkbox"
                      checked={overlayEnabled}
                      onChange={(e) => setOverlayEnabled(e.target.checked)}
                      className="accent-ink"
                    />
                    <span>Detections</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-caption text-ink-soft hover:text-ink">
                    <input
                      type="checkbox"
                      checked={sceneEnabled}
                      onChange={(e) => setSceneEnabled(e.target.checked)}
                      className="accent-ink"
                    />
                    <span>Relations</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-line/60 pt-1.5 font-mono text-caption text-ink-faint">
                <span className="font-medium text-[#8a5f00]">
                  {formatTimestampContext(targetTimestamp).contextText.toLowerCase()}
                </span>
                <span>{formatTimestampContext(targetTimestamp).evidenceWindow}</span>
              </div>
            </div>

            {videoNotFound && (
              <div className="border border-signal/40 bg-signal/5 p-3 text-small text-[#8a5f00]">
                <span className="font-medium">source video unavailable:</span> target video id{' '}
                <code className="font-mono">{targetVideoId}</code> was not found.
              </div>
            )}

            {/* Dominant Video Viewport */}
            {selectedVideo ? (
              <div className="flex flex-col overflow-hidden border border-line bg-ink shadow-sm">
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
                  <FaceRedactionOverlay
                    entities={perception.data?.entities}
                    frame={perception.data}
                    sourceWidth={selectedVideo?.metadata?.width || 1280}
                    sourceHeight={selectedVideo?.metadata?.height || 720}
                    displayWidth={videoBoxSize.width}
                    displayHeight={videoBoxSize.height}
                  />
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
                  {sceneEnabled && scene.data && (
                    <SceneOverlay
                      snapshot={scene.data}
                      sourceWidth={selectedVideo?.metadata?.width || 1280}
                      sourceHeight={selectedVideo?.metadata?.height || 720}
                    />
                  )}
                  {whatIfSimulation?.current && (
                    <HypotheticalOverlay
                      candidate={activeCandidate}
                      current={whatIfSimulation.current}
                      sourceWidth={selectedVideo?.metadata?.width || 1280}
                      sourceHeight={selectedVideo?.metadata?.height || 720}
                    />
                  )}
                </VideoViewport>

                <div className="flex items-center justify-between border-t border-ink bg-ink px-3 py-1.5 text-caption text-paper/70">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse motion-reduce:animate-none" />
                    <span>Camera: <strong className="text-paper">{videoInfo.cameraName}</strong></span>
                  </span>
                  <span>Worker privacy active (faces obscured)</span>
                </div>
              </div>
            ) : (
              <div className="border border-line bg-surface p-8 text-center">
                <p className="text-small font-medium text-ink">
                  {videosLoading ? 'loading video source…' : 'video evidence stream connecting'}
                </p>
                <p className="mt-1 text-caption text-ink-soft">preparing optical telemetry for this incident.</p>
              </div>
            )}

            <div ref={whatIfRef}>
              {(whatIfSimulation || whatIfLoading || whatIfError) && (
                <div className="mt-2 border border-ok/40 bg-surface">
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

          {/* Right Column: Dominant Decision Intelligence Card (5 cols) */}
          <div className="flex flex-col gap-4 lg:col-span-5">
            <div className="border border-line bg-surface shadow-sm">
              {/* Card Header */}
              <div className="flex items-center justify-between border-b border-line bg-paper px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`border px-2 py-0.5 text-label font-bold uppercase tracking-wider ${BAND_STYLE[incidentEvent.band] || BAND_STYLE.High}`}>
                    {incidentEvent.band || 'High'} Risk
                  </span>
                  <span className="text-caption font-semibold text-ink">{videoInfo.cameraName}</span>
                </div>
                {isVerifiedPrevented ? (
                  <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-bold text-ok">
                    ✓ Prevention Verified
                  </span>
                ) : (
                  <span className="border border-line bg-surface px-2 py-0.5 text-label font-medium text-ink-soft">
                    Pending Verification
                  </span>
                )}
              </div>

              {/* 4-Step Sequence in One Clean Column */}
              <div className="divide-y divide-line">
                {/* 1. Observed Condition */}
                <div className="p-4 flex flex-col gap-1.5">
                  <span className="text-label font-bold uppercase tracking-wider text-ink-faint">
                    1. Observed Condition
                  </span>
                  <h2 className="text-base font-bold text-ink leading-tight">{title}</h2>
                  <p className="text-small text-ink-soft leading-relaxed">
                    {humanizeExplanation(incidentEvent.explanation || config.whatIsHappening, incidentEvent.scenario, incidentEvent.entity_id)}
                  </p>
                </div>

                {/* 2. Physical Hazard & Consequence */}
                <div className="p-4 flex flex-col gap-1.5 bg-paper/50">
                  <div className="flex items-center justify-between">
                    <span className="text-label font-bold uppercase tracking-wider text-[#8a5f00]">
                      2. Hazard &amp; Risk Consequence
                    </span>
                    <span className="text-small font-bold text-danger">
                      Score {formatScore(incidentEvent.score)}/100
                    </span>
                  </div>
                  <p className="text-small text-ink-soft leading-relaxed">
                    {humanizeExplanation(rationaleText, incidentEvent.scenario)}
                  </p>
                </div>

                {/* 3. Recommended Intervention */}
                <div className="p-4 flex flex-col gap-3 bg-ok/5 border-l-2 border-ok">
                  <div className="flex items-center justify-between">
                    <span className="text-label font-bold uppercase tracking-wider text-ok">
                      3. Required Safe Action
                    </span>
                    {safePlan?.evidence_status && (
                      <span className="text-caption font-mono uppercase px-1.5 py-0.5 border border-ok/40 bg-ok/10 text-ok font-semibold">
                        {safePlan.evidence_status}
                      </span>
                    )}
                  </div>

                  <strong className="text-small font-bold text-ink leading-snug">
                    {humanizeAction(safePlan?.immediate_action || actionText || 'Reposition cargo safely', incidentEvent.scenario)}
                  </strong>

                  {safePlan?.steps && safePlan.steps.length > 1 && (
                    <div className="flex flex-col gap-1.5 pt-2 border-t border-ok/20">
                      <span className="text-label font-medium text-ink-soft uppercase tracking-wider">action steps:</span>
                      <ol className="list-decimal list-inside space-y-1 text-caption text-ink font-medium">
                        {safePlan.steps.map((step, idx) => (
                          <li key={idx} className="leading-normal">{humanizeAction(step.replace(/^\d+\.\s*/, ''), incidentEvent.scenario)}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {safePlan?.verification && (
                    <div className="bg-surface border border-ok/40 p-2 text-caption text-ink flex items-start gap-1.5">
                      <span className="font-semibold text-ok shrink-0">✓ Verify:</span>
                      <span className="leading-tight">{humanizeExplanation(safePlan.verification, incidentEvent.scenario)}</span>
                    </div>
                  )}
                </div>

                {/* 4. Primary Next-Step Workflow CTAs */}
                <div className="p-4 flex flex-col gap-2.5 bg-surface">
                  <span className="text-label font-bold uppercase tracking-wider text-ink-faint">
                    Next Workflow Step
                  </span>

                  {isWhatIfEligible ? (
                    <>
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
                        className="inline-flex items-center justify-center gap-2 border border-ok bg-ok px-4 py-2.5 text-small font-bold text-paper shadow-sm transition-colors hover:opacity-90 cursor-pointer w-full"
                      >
                        <FlaskConical size={16} />
                        Step 4: Run What-If Simulator →
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          navigateTo('Action Center', {
                            eventId: incidentEvent.event_id,
                            videoId: incidentEvent.video_id || selectedVideo?.id,
                            timestamp: targetTimestamp,
                            event: incidentEvent,
                          })
                        }
                        className="inline-flex items-center justify-center gap-1.5 border border-line bg-paper px-3.5 py-2 text-caption font-semibold text-ink transition-colors hover:border-ink cursor-pointer w-full"
                      >
                        Step 5: View Safe Action Plan →
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        navigateTo('Action Center', {
                          eventId: incidentEvent.event_id,
                          videoId: incidentEvent.video_id || selectedVideo?.id,
                          timestamp: targetTimestamp,
                          event: incidentEvent,
                        })
                      }
                      className="inline-flex items-center justify-center gap-2 border border-ink bg-ink px-4 py-2.5 text-small font-bold text-paper shadow-sm transition-colors hover:bg-ink-soft cursor-pointer w-full"
                    >
                      Step 5: View Safe Action Plan →
                    </button>
                  )}
                </div>

                {/* 5. Post-Action Verification Status */}
                <div className="p-4 flex flex-col gap-2.5 bg-paper">
                  <div className="flex items-center justify-between">
                    <span className="text-label font-bold uppercase tracking-wider text-ink-faint">
                      4. Post-Action Verification
                    </span>
                    {isVerifiedPrevented ? (
                      <span className="font-semibold text-caption text-ok">Resolution Verified</span>
                    ) : (
                      <span className="text-caption text-ink-faint">Pending Verification</span>
                    )}
                  </div>

                  {outcomeMeasurement ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-caption text-ink-soft leading-relaxed">
                        {isVerifiedPrevented
                          ? '✓ Prevention confirmed: load stabilized before any damage occurred.'
                          : outcomeMeasurement.explanation
                            ? humanizeExplanation(outcomeMeasurement.explanation)
                            : 'Subsequent frames are awaiting operator verification.'}
                      </p>

                      {threeConditions.length > 0 && (
                        <div className="flex flex-col gap-1 border-t border-line/60 pt-2">
                          {threeConditions.map((c) => {
                            const friendlyName = c.condition_number === 1
                              ? 'Hazard detected & tracked'
                              : c.condition_number === 2
                              ? 'Intervention applied'
                              : 'Subsequent frames safe'
                            return (
                              <div key={c.condition_number} className="flex items-center gap-1.5 text-caption">
                                <span className={`font-mono font-bold ${c.satisfied ? 'text-ok' : 'text-ink-faint'}`}>
                                  {c.satisfied ? '✓' : '✕'}
                                </span>
                                <span className={c.satisfied ? 'font-medium text-ink' : 'text-ink-soft'}>
                                  {friendlyName}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="text-caption text-ink-soft">
                        Evaluate subsequent video footage to verify whether operator intervention eliminated this hazard.
                      </p>
                      <button
                        type="button"
                        disabled={outcomeVerifying}
                        onClick={() => handleVerifyOutcome(verificationWindow)}
                        className="w-full bg-ink py-2 text-caption font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50 cursor-pointer"
                      >
                        {outcomeVerifying ? 'Verifying subsequent video…' : 'Verify Post-Action Outcome'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* accordions */}
      <div className="flex flex-col gap-3">
        <Accordion
          title="Why TRACE Flagged This Hazard"
          open={showHowTraceKnows}
          onToggle={() => setShowHowTraceKnows(!showHowTraceKnows)}
        >
          <div className="flex flex-col gap-4">
            <div className="border border-ok/40 bg-ok/5 p-4">
              <span className="text-small font-bold text-ink block mb-2">Verified Visual Evidence:</span>
              <ul className="list-inside list-disc space-y-1.5 text-small text-ink">
                {generateWhyTraceFlaggedThis(incidentEvent, config, isVerifiedPrevented).map((bullet, idx) => (
                  <li key={idx}>{bullet}</li>
                ))}
              </ul>
            </div>

            {telemetryEntries(evidence).length > 0 && (
              <div className="border border-line bg-paper p-3.5">
                <span className="text-caption font-semibold text-ink block mb-2">Key Recorded Observations:</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {telemetryEntries(evidence).slice(0, 4).map(([k, v]) => (
                    <div key={k} className="border border-line bg-surface p-2 text-caption">
                      <span className="block text-label text-ink-faint">{formatEvidenceKey(k)}</span>
                      <strong className="text-ink font-semibold">{formatEvidenceValue(k, v)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <SupervisorRuleNotice evidence={evidence} />
          </div>
        </Accordion>

        <Accordion
          title="operator review & audit trail"
          open={showOperatorReview}
          onToggle={() => setShowOperatorReview(!showOperatorReview)}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-small font-semibold text-ink">human supervisor audit feedback</span>
              {incidentEvent?.reviewed && incidentEvent?.review_status && (
                <span className={`border px-2 py-0.5 text-label font-medium ${REVIEW_BADGES[incidentEvent?.review_status]?.style}`}>
                  {REVIEW_BADGES[incidentEvent?.review_status]?.label}
                </span>
              )}
            </div>

            {reviewMessage && (
              <div className={`border p-2.5 font-mono text-caption ${reviewMessage.type === 'success' ? 'border-ok/40 bg-ok/10 text-ok' : 'border-danger bg-danger/5 text-danger'}`}>
                {reviewMessage.text}
              </div>
            )}

            <input
              type="text"
              placeholder="Optional supervisor audit notes…"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              className="border border-line bg-surface px-3 py-1.5 font-mono text-small text-ink placeholder:text-ink-faint focus:border-ink"
            />

            <div className="grid grid-cols-3 gap-px bg-line">
              <button
                type="button"
                disabled={reviewLoading}
                onClick={() => handleReviewSubmit('confirmed_damage')}
                className="bg-surface px-2 py-1.5 text-caption font-medium text-danger transition-colors hover:bg-paper disabled:opacity-50"
              >
                confirmed damage
              </button>
              <button
                type="button"
                disabled={reviewLoading}
                onClick={() => handleReviewSubmit('false_positive')}
                className="bg-surface px-2 py-1.5 text-caption font-medium text-steel transition-colors hover:bg-paper disabled:opacity-50"
              >
                false positive
              </button>
              <button
                type="button"
                disabled={reviewLoading}
                onClick={() => handleReviewSubmit('unresolved')}
                className="bg-surface px-2 py-1.5 text-caption font-medium text-ink-soft transition-colors hover:bg-paper disabled:opacity-50"
              >
                unresolved
              </button>
            </div>
          </div>
        </Accordion>
      </div>
    </div>
  )
}

function Accordion({ title, open, onToggle, children }) {
  return (
    <div className="border border-line bg-surface">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-paper px-4 py-3 text-left text-small font-medium text-ink transition-colors hover:bg-line"
      >
        <span>{title}</span>
        <span className="font-mono text-caption text-ink-faint">{open ? 'collapse' : 'expand'}</span>
      </button>
      {open && <div className="border-t border-line p-4">{children}</div>}
    </div>
  )
}

function Telemetry({ label, value, note, tone }) {
  const valueCls = tone === 'ok' ? 'text-ok' : tone === 'signal' ? 'text-[#8a5f00]' : tone === 'danger' ? 'text-danger' : 'text-ink'
  return (
    <div className="flex flex-col gap-0.5 bg-paper p-2.5">
      <span className="text-label font-medium text-ink-faint">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${valueCls}`}>{value}</span>
      <span className="text-caption text-ink-faint">{note}</span>
    </div>
  )
}

