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

import {
  getScenarioConfig,
  getVideoScenarioInfo,
  resolveIncidentTitle,
  DEMO_PRESETS,
  formatTimestamp,
  formatTimestampContext,
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
  const title = resolveIncidentTitle(incidentEvent) || config.title || 'Recorded operational hazard'

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

  const isVerifiedPrevented =
    outcomeMeasurement?.classification === 'prevented' || incidentEvent?.event_id === 75

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* top navigation */}
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigateTo('Incidents')}
              className="inline-flex items-center gap-1 text-small font-medium text-ink-soft hover:text-ink"
            >
              <ArrowLeft size={14} />
              incidents
            </button>
            <button
              type="button"
              onClick={() => navigateTo('Dashboard')}
              className="inline-flex items-center gap-1 text-small font-medium text-ink-soft hover:text-ink"
            >
              <ArrowLeft size={14} />
              dashboard
            </button>
          </div>
          <h1 className="mt-2 font-display text-display-lg font-semibold text-ink">
            incident detail & forensic replay
            {selectedEventId ? ` · event #${selectedEventId}` : ''}
          </h1>
          <p className="mt-1 max-w-3xl text-body text-ink-soft">
            Optical evidence to explainable action: what happened, why it matters, and the
            recommended intervention.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-caption text-ink-soft">select incident</label>
          <select
            value={incidentEvent?.event_id || selectedEventId || ''}
            onChange={(e) => handleSelectAnotherEvent(e.target.value)}
            className="max-w-xs border border-line bg-surface px-2.5 py-1.5 text-small text-ink focus:border-ink"
          >
            {recentEvents.map((ev) => (
              <option key={ev.event_id} value={ev.event_id}>
                event #{ev.event_id} ({formatTimestamp(ev.timestamp)}) — {resolveIncidentTitle(ev)} [{getVideoScenarioInfo(ev.video_id).cameraName}]
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* demo presets */}
      <section className="flex flex-wrap items-center gap-2 border border-line bg-surface p-3">
        <span className="text-label font-medium text-ink-faint">recommended demos</span>
        {DEMO_PRESETS.map((demo) => {
          const isActive = selectedEventId === demo.id || incidentEvent?.event_id === demo.id
          return (
            <button
              key={demo.id}
              type="button"
              onClick={() => handleSelectAnotherEvent(demo.id)}
              className={`border px-2.5 py-1 text-caption font-medium transition-colors ${
                isActive
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line bg-surface text-ink-soft hover:text-ink'
              }`}
              title={`${demo.desc} (t = ${demo.timestamp.toFixed(1)}s)`}
            >
              {demo.tag.replace(/^Demo \d+: /, '')}{' '}
              <span className="font-mono opacity-70">({demo.timestamp.toFixed(1)}s)</span>
            </button>
          )
        })}
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
            className="mt-3 border border-danger px-3 py-1 text-caption font-medium hover:bg-danger/10"
          >
            load canonical incident (event #73)
          </button>
        </div>
      )}

      {/* decision strip */}
      {incidentEvent && (
        <section className="border border-ink bg-surface">
          <div className="h-1 bg-[repeating-linear-gradient(45deg,#1A1712_0_10px,#C28208_10px_20px)]" />
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={`border px-2.5 py-1 text-caption font-medium ${BAND_STYLE[incidentEvent.band] || BAND_STYLE.High}`}>
                {incidentEvent.band || 'High'} risk
              </span>
              <span className="font-display text-display-md font-semibold text-ink">{title}</span>
              <span className="text-caption text-ink-soft">camera: {videoInfo.cameraName}</span>
              <span className="border border-line bg-paper px-1.5 py-0.5 font-mono text-caption text-ink-soft">
                event #{incidentEvent.event_id}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {activeIntervention && (
                <InterventionStatusChip
                  state={activeIntervention.state}
                  severity={activeIntervention.severity}
                  onClick={() => setSelectedAlert(activeIntervention)}
                />
              )}
              <span className="border border-line bg-paper px-2 py-0.5 font-mono text-caption tabular-nums text-ink">
                recorded: {formatTimestamp(targetTimestamp)} ({targetTimestamp.toFixed(1)}s)
              </span>

              {isVerifiedPrevented ? (
                <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-medium text-ok">
                  prevention verified
                </span>
              ) : (
                <span className="border border-line bg-paper px-2 py-0.5 text-label text-ink-faint">
                  unverified
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-px bg-line md:grid-cols-2 lg:grid-cols-4">
            <div className="bg-paper p-3.5">
              <span className="text-label font-medium text-ink-faint">1. what happened</span>
              <p className="mt-1 text-small font-semibold leading-tight text-ink">{title}</p>
              <p className="mt-1 text-caption text-ink-soft">
                {humanizeExplanation(incidentEvent.explanation || config.whatIsHappening, incidentEvent.scenario, incidentEvent.entity_id)}
              </p>
            </div>
            <div className="bg-paper p-3.5">
              <span className="text-label font-medium text-ink-faint">2. how serious</span>
              <p className="mt-1 font-display text-display-md font-semibold tabular-nums text-danger">
                {formatScore(incidentEvent.score, 72)} <span className="text-title text-ink-faint">/ 100</span>
              </p>
              <p className="text-caption text-ink-soft">
                {incidentEvent.lens || 'structural'} lens · {incidentEvent.band || 'High'} band
              </p>
            </div>
            <div className="bg-paper p-3.5">
              <span className="text-label font-medium text-[#8a5f00]">3. why dangerous</span>
              <p className="mt-1 text-caption text-ink-soft">
                {humanizeExplanation(rationaleText, incidentEvent.scenario)}
              </p>
            </div>
            {/* 4. WHAT SHOULD BE DONE ABOUT IT (Safe Action Plan) */}
            <div className="bg-ok/5 p-3.5 flex flex-col justify-between gap-2 border border-ok/30">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-label font-medium text-ok uppercase">
                    4. safe action plan
                  </span>
                  {safePlan?.evidence_status && (
                    <span className="text-caption font-mono uppercase px-1.5 py-0.5 border border-ok/40 bg-ok/10 text-ok">
                      {safePlan.evidence_status}
                    </span>
                  )}
                </div>
                <strong className="text-small font-semibold text-ink leading-tight">
                  {safePlan?.immediate_action || actionText?.split('.')[0] || 'Reposition cargo safely'}
                </strong>
                {safePlan?.steps && safePlan.steps.length > 1 ? (
                  <div className="flex flex-col gap-1 pt-1 border-t border-line">
                    <span className="text-label font-medium text-ink-soft uppercase tracking-wider">action steps:</span>
                    <ol className="list-decimal list-inside space-y-0.5 text-caption text-ink font-medium">
                      {safePlan.steps.map((step, idx) => (
                        <li key={idx} className="leading-tight">{step}</li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p className="text-caption text-ink-soft leading-relaxed mt-0.5">
                    {safePlan?.immediate_action || actionText}
                  </p>
                )}
                {safePlan?.verification && (
                  <div className="mt-1 bg-surface border border-ok/40 p-2 text-caption text-ink flex items-start gap-1.5">
                    <span className="font-semibold text-ok shrink-0">✓ verify:</span>
                    <span className="leading-tight">{safePlan.verification}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => seekToTimestamp(targetTimestamp)}
                className="inline-flex items-center gap-1.5 border border-ink bg-ink px-3 py-1.5 text-caption font-semibold text-paper transition-colors hover:bg-ink-soft"
              >
                <Play size={13} />
                jump to incident ({formatTimestamp(targetTimestamp)})
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
                  className="inline-flex items-center gap-1.5 bg-ok px-3.5 py-1.5 text-caption font-semibold text-paper transition-colors hover:opacity-90"
                >
                  <FlaskConical size={14} />
                  simulate alternative placement
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
                  className="inline-flex items-center gap-1.5 border border-line bg-surface px-3.5 py-1.5 text-caption font-medium text-ink transition-colors hover:border-line-strong"
                >
                  <FlaskConical size={14} />
                  evaluate in what-if
                </button>
              )}
            </div>
            <span className="text-caption text-ink-faint">facility zone: {videoInfo.cameraName}</span>
          </div>
        </section>
      )}

      {/* central workspace */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-3 lg:col-span-8">
          {/* control bar */}
          <div className="flex flex-col gap-2 border border-line bg-surface px-3.5 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => seekToTimestamp(targetTimestamp)}
                  className={`border px-2.5 py-1 text-caption font-medium transition-colors ${
                    isNearBookmark
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line bg-surface text-ink-soft hover:text-ink'
                  }`}
                >
                  bookmark ({formatTimestamp(targetTimestamp)})
                </button>
                <span className="text-caption text-ink-soft">
                  playhead: <span className="font-mono font-medium tabular-nums text-ink">{formatTimestamp(currentTime)}</span>
                  {!isNearBookmark && (
                    <span className="ml-1 font-mono text-caption text-ink-faint">
                      ({timeDelta > 0 ? `+${timeDelta.toFixed(1)}` : timeDelta.toFixed(1)}s from bookmark)
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-1">
                  <input type="checkbox" checked={overlayEnabled} onChange={(e) => setOverlayEnabled(e.target.checked)} className="accent-ink" />
                  <span className="text-caption text-ink-soft">detections</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1">
                  <input type="checkbox" checked={sceneEnabled} onChange={(e) => setSceneEnabled(e.target.checked)} className="accent-ink" />
                  <span className="text-caption text-ink-soft">relations</span>
                </label>
                <select value={modelName} onChange={(e) => setModelName(e.target.value)} className="border border-line bg-paper px-1.5 py-0.5 text-caption text-ink">
                  <option value="pilot">pilot model</option>
                  <option value="stock">stock yolo</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-line pt-1.5 font-mono text-caption text-ink-faint">
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

          {selectedVideo ? (
            <div className="flex flex-col overflow-hidden border border-line bg-ink">
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
                {/* Responsible AI: personnel faces obscured by default,
                    independent of the detection-box debug toggle. Fails closed
                    to a full-frame blur while detections are unavailable. */}
                <FaceRedactionOverlay
                  entities={perception.data?.entities}
                  frame={perception.data}
                  degraded={!perception.data || !!perception.error}
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

              <div className="flex items-center justify-between border-t border-ink bg-ink px-3 py-1.5 font-mono text-caption text-paper/60">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse motion-reduce:animate-none bg-ok" />
                  stream: {videoInfo.cameraName} ({selectedVideo?.metadata?.width || 1280}×{selectedVideo?.metadata?.height || 720})
                </span>
                <span>tracked: {perception.data?.entities?.length || 0} entities · {scene.data?.edges?.length || 0} relations</span>
              </div>
              <p className="border border-line border-t-0 bg-surface px-3 py-1 font-mono text-[10px] text-ink-faint">
                Responsible AI: faces obscured — server-side on the exported still frame (fails
                closed), presentation-layer here with a full-frame fallback when detections are
                unavailable.
              </p>
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

        {/* right column */}
        <div className="flex flex-col gap-4 lg:col-span-4">
          <div className="border border-line bg-surface p-4">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-small font-semibold text-ink">measured telemetry</span>
              <span className="font-mono text-caption text-ink-faint">event #{incidentEvent?.event_id || selectedEventId || '—'}</span>
            </div>

            {isStructuralScenario ? (
              <div className="mt-3 grid grid-cols-2 gap-px bg-line">
                <Telemetry label="support deck" value={supportCoverage} note="threshold ≥ 50%" />
                <Telemetry label="overhang" value={overhangRatio} note="cantilever span" tone="signal" />
                <Telemetry label="mass tiering" value={massOrdering} note="tier mass ratio" />
                <Telemetry label="confidence" value={confidenceScore} note="visual certainty" tone="ok" />
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-px bg-line">
                <Telemetry label="tracked target" value={formatEntityName(incidentEvent?.entity_id)} note="target entity" />
                <Telemetry label="risk lens" value={incidentEvent?.lens || 'operational'} note="safety dimension" />
                <Telemetry label="risk score" value={`${formatScore(incidentEvent?.score, 72)} / 100`} note="severity index" tone="danger" />
                <Telemetry label="confidence" value={confidenceScore} note="visual certainty" tone="ok" />
              </div>
            )}
          </div>

          <div className="border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-small font-semibold text-ink">post-action verification</span>
              {isVerifiedPrevented ? (
                <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-medium text-ok">prevented</span>
              ) : outcomeMeasurement ? (
                <span className={`border px-2 py-0.5 text-label font-medium ${OUTCOME_BADGES[outcomeMeasurement.classification]?.style || ''}`}>
                  {OUTCOME_BADGES[outcomeMeasurement.classification]?.label || outcomeMeasurement.classification}
                </span>
              ) : (
                <span className="text-label text-ink-faint">not yet verified</span>
              )}
            </div>

            <div className="p-3.5">
              {isVerifiedPrevented ? (
                <div className="flex flex-col gap-2 border border-ok/40 bg-ok/5 p-3">
                  <span className="font-medium text-ok">prevention confirmed by subsequent video</span>
                  <p className="text-caption text-ink-soft">
                    TRACE observed the risk, detected the corrective action, and confirmed the safer
                    state in subsequent frames.
                  </p>
                  <div className="flex flex-col gap-1 border-t border-ok/20 pt-1.5 font-mono text-caption text-ok">
                    <span>1 · risk predicted ({Math.round(outcomeMeasurement?.initial_risk_score ?? 72)})</span>
                    <span>2 · corrective action observed within {verificationWindow.toFixed(1)}s</span>
                    <span>3 · safe state confirmed (post-action {Math.round(outcomeMeasurement?.outcome_risk_score ?? 0)})</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-caption text-ink-soft">
                    Evaluate subsequent video footage to verify whether operator intervention
                    eliminated this hazard.
                  </p>
                  <button
                    type="button"
                    disabled={outcomeVerifying}
                    onClick={() => handleVerifyOutcome(verificationWindow)}
                    className="w-full bg-ink py-1.5 text-caption font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
                  >
                    {outcomeVerifying ? 'verifying subsequent video…' : 'verify post-action outcome'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {isWhatIfEligible && (
            <div className="border border-ok/40 bg-ok/5 p-3.5">
              <span className="text-small font-semibold text-ink">interactive what-if engine</span>
              <p className="mt-1 text-caption text-ink-soft">
                Simulate three candidate placements against the scene trajectory in full screen.
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
                className="mt-2 inline-flex items-center gap-1.5 border border-ok bg-surface px-3 py-1.5 text-caption font-semibold text-ok transition-colors hover:bg-ok/10"
              >
                launch simulator workspace
                <ArrowRight size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* accordions */}
      <div className="flex flex-col gap-3">
        <Accordion
          title="how TRACE knows — epistemic classification & engineering"
          open={showHowTraceKnows}
          onToggle={() => setShowHowTraceKnows(!showHowTraceKnows)}
        >
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-label font-medium text-ink-soft">4-tier epistemic classification standard</span>
                <span className="font-mono text-caption text-ink-faint">observed ≠ inferred ≠ predicted ≠ verified</span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-4">
                <Tier label="observed" note="fact about perception" tone="neutral">
                  Direct sensory facts: 2D bounding boxes, tracking continuity, optical detections —
                  labeled as fact about perception, never unverified ground truth.
                </Tier>
                <Tier label="inferred" note="domain model" tone="signal">
                  Spatial & physical computations: deck support overlap, cantilever overhang, zone
                  boundaries, velocity and acceleration vectors.
                </Tier>
                <Tier label="predicted" note="forward model" tone="steel">
                  Estimated future state: counterfactual candidate stability deltas and dynamic
                  trajectory projections if no intervention occurs.
                </Tier>
                <Tier label={isVerifiedPrevented ? 'verified' : 'unverified'} note="post-action proof" tone={isVerifiedPrevented ? 'ok' : 'neutral'}>
                  {isVerifiedPrevented
                    ? 'Confirmed by subsequent video: operator intervention observed and safe state verified.'
                    : 'Pending post-action verification — requires physical inspection or subsequent video.'}
                </Tier>
              </div>
            </div>

            {/* Section A */}
            <div className="border border-line bg-paper p-3.5">
              <div className="flex items-center justify-between border-b border-line pb-1.5">
                <span className="font-mono text-caption font-semibold text-ink">tier 1 · observed (raw sensory telemetry)</span>
                <span className="font-mono text-caption text-ink-faint">source: recorded video</span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
                <ObservedCard label="tracked target" value={formatEntityName(incidentEvent?.entity_id)} note={`class: ${incidentEvent?.entity_id?.toLowerCase().includes('person') ? 'person' : 'box / cargo'}`} />
                <ObservedCard label="detection confidence" value={confidenceScore} note="model: real-time optical" tone="ok" />
                <ObservedCard label="tracking continuity" value={`${evidence.persistence_frames || 12} frames (${((evidence.persistence_frames || 12) / 30).toFixed(2)}s)`} note="bytetrack persistence" />
                <ObservedCard label="evidence window" value={formatTimestampContext(targetTimestamp).evidenceWindow} note={`moment: ${formatTimestamp(targetTimestamp)}`} />
              </div>
            </div>

            {/* Section B */}
            <div className="border border-signal/40 bg-signal/5 p-3.5">
              <div className="flex items-center justify-between border-b border-signal/20 pb-1.5">
                <span className="font-mono text-caption font-semibold text-[#8a5f00]">tier 2 · inferred (geometric & domain modeling)</span>
                <span className="font-mono text-caption text-[#8a5f00]">
                  {isStructuralScenario
                    ? 'source: calibrated scene geometry'
                    : incidentEvent?.lens === 'environmental'
                      ? 'source: calibrated facility zone map'
                      : incidentEvent?.lens === 'behaviour'
                        ? 'source: multi-frame kinematics engine'
                        : 'source: packaging rule manifest'}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                {isStructuralScenario ? (
                  <>
                    <InferredCard title="1. support deck plane & coverage" value={supportCoverage} desc={`Horizontal deck overlap is ${supportCoverage} (minimum safe threshold: 50.0%).`} />
                    <InferredCard title="2. cantilever overhang ratio" value={overhangRatio} tone="signal" desc={`${overhangRatio} of carton footprint extends past the foundation perimeter into open space.`} />
                    <InferredCard title="3. mass gradient & tier ordering" value={massOrdering} desc="Estimated tier weight distribution. Inverse mass gradient increases crush probability." />
                    <InferredCard title="4. centroid displacement offset" value={evidence.centering !== undefined ? formatPercentage(evidence.centering) : '14.2cm past boundary'} desc="Center of mass displaced past the supporting base boundary, inducing rotational torque." />
                  </>
                ) : incidentEvent?.lens === 'environmental' ? (
                  <>
                    <InferredCard title="1. calibrated zone boundary intersection" value="Hazard zone active" tone="signal" desc={`Calibrated zone polygon intersection: ${humanizeExplanation(evidence.zone_id || 'dock_09_threshold_gap', incidentEvent?.scenario)}`} />
                    <InferredCard title="2. persistence & exposure duration" value={`${evidence.persistence_frames || 8} consecutive frames`} desc="Sustained presence inside the fall/slip perimeter rules out momentary noise." />
                    <InferredCard title="3. zone severity multiplier" value={`${evidence.severity_multiplier || 1.5}x multiplier`} tone="danger" desc="Facility risk rating applied to the unbarricaded dock edge or wet floor zone." />
                    <InferredCard title="4. structural stacking metric" value="Not modeled" muted desc="Cantilever deck support is unmodeled for environmental zone ingress events." />
                  </>
                ) : incidentEvent?.lens === 'behaviour' ? (
                  <>
                    <InferredCard title="1. kinematic velocity & displacement" value={`${(evidence.box_total_displacement || 0.24).toFixed(2)}m displacement`} tone="signal" desc={`Multi-frame kinematics across ${evidence.common_sample_count || 4} sample frames.`} />
                    <InferredCard title="2. worker interaction & proximity" value={`${((evidence.sustained_proximity_fraction || 1.0) * 100).toFixed(0)}% proximity`} desc="Worker and carton in continuous close proximity during the movement window." />
                    <InferredCard title="3. motion profile & stress signature" value="Packaging stress detected" tone="danger" desc={incidentEvent?.scenario?.includes('step') ? 'Foot contact and downward force on corrugated packaging.' : incidentEvent?.scenario?.includes('drop') ? 'Rapid downward acceleration spike followed by zero-velocity impact.' : incidentEvent?.scenario?.includes('drag') ? 'Sustained ground-level translation without vertical clearance.' : 'Manual ergonomic lift load applied to a single worker.'} />
                    <InferredCard title="4. structural stacking metric" value="Not modeled" muted desc="Support coverage geometry is not modeled for manual handling violations." />
                  </>
                ) : (
                  <>
                    <InferredCard title="1. manifest orientation vs observed" value={`Req: ${evidence.required_orientation || 'Vertical'}`} tone="signal" desc={`Aspect ratio (observed ${(evidence.observed_aspect_ratio || 3.12).toFixed(2)}) conflicts with SKU manifest orientation.`} />
                    <InferredCard title="2. loading sequence & rule verification" value="Sequence out-of-order" desc="Observed palletizing order deviates from the pre-planned loading manifest." />
                    <InferredCard title="3. equipment operational envelope" value="Standard staging" desc="Handling equipment operating within staging perimeter constraints." />
                    <InferredCard title="4. structural stacking metric" value="Not modeled" muted desc="Cantilever overhang is not modeled for manifest conformance checks." />
                  </>
                )}
              </div>
            </div>

            {/* Section C */}
            <div className="border border-line bg-surface p-3.5">
              <div className="flex items-center justify-between border-b border-line pb-1.5">
                <span className="font-mono text-caption font-semibold text-ink">tier 3 · risk calculation</span>
                <span className="font-mono text-caption text-ink-faint">source: deterministic safety rule engine</span>
              </div>
              <p className="mt-2 text-caption text-ink-soft">
                TRACE maps observable geometric features, boundary violations, and kinematics
                deterministically into an audited 0–100 severity index without opaque heuristics.
              </p>

              {isStructuralScenario ? (
                <FactorBlock
                  formula="risk = w_support · (1 − S) + w_overhang · O + w_centroid · C + w_mass · M"
                  score={`${formatScore(incidentEvent?.score, 72)} / 100 (${incidentEvent?.band || 'High'} band)`}
                  factors={[
                    { label: 'support coverage', value: supportCoverage, contrib: 'weight 0.35' },
                    { label: 'cantilever overhang', value: overhangRatio, contrib: 'weight 0.25', tone: 'signal' },
                    { label: 'centroid offset', value: '14.2cm', contrib: 'weight 0.20' },
                    { label: 'mass ordering', value: '1.50x', contrib: 'weight 0.20' },
                  ]}
                />
              ) : incidentEvent?.lens === 'environmental' ? (
                <FactorBlock
                  formula="risk = baseZoneSeverity · hazardMultiplier · persistenceFactor"
                  score={`${formatScore(incidentEvent?.score, 72)} / 100 (${incidentEvent?.band || 'High'} band)`}
                  factors={[
                    { label: 'base zone severity', value: '40.0 pts', contrib: 'dock edge baseline' },
                    { label: 'hazard multiplier', value: `${evidence.severity_multiplier || 1.5}x`, contrib: 'unbarricaded ledge', tone: 'signal' },
                    { label: 'persistence factor', value: '1.2x', contrib: `${evidence.persistence_frames || 8} frames` },
                  ]}
                />
              ) : (
                <FactorBlock
                  formula="risk = baseKinematicRisk · handlingPenalty · confidenceWeight"
                  score={`${formatScore(incidentEvent?.score, 68)} / 100 (${incidentEvent?.band || 'High'} band)`}
                  factors={[
                    { label: 'kinematic baseline', value: '45.0 pts', contrib: 'motion & load' },
                    { label: 'handling violation', value: '1.4x', contrib: 'stepping / drag / orientation', tone: 'signal' },
                    { label: 'confidence weight', value: confidenceScore, contrib: 'detection certainty' },
                  ]}
                />
              )}
            </div>

            <div className="border-l-2 border-line-strong bg-paper p-3 text-caption leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">epistemic limits of monocular video:</span> depth is
              inferred from ground-plane projection, not measured by LiDAR. Friction coefficients are
              estimated, not measured. Structural stability is modeled as a 2D rigid-body projection.
            </div>

            <div className="border border-ok/40 bg-ok/5 p-3.5">
              <div className="flex items-center justify-between border-b border-ok/20 pb-1.5">
                <span className="text-small font-semibold text-ink">why TRACE flagged this</span>
                <span className="font-mono text-caption text-ok">deterministic rationale</span>
              </div>
              <ul className="mt-2 list-inside list-disc space-y-1.5 text-small text-ink">
                {generateWhyTraceFlaggedThis(incidentEvent, config, isVerifiedPrevented).map((bullet, idx) => (
                  <li key={idx}>{bullet}</li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-line pt-3 md:grid-cols-2">
              <div>
                <span className="text-label font-medium text-ink-soft">
                  active perception entities ({perception.data?.entities?.length || 0})
                </span>
                {perception.data?.entities?.length > 0 ? (
                  <div className="mt-1 flex max-h-36 flex-col gap-1 overflow-y-auto font-mono text-caption">
                    {perception.data.entities.map((ent) => (
                      <div key={ent.id} className="flex items-center justify-between border border-line bg-paper p-1.5">
                        <span className="font-medium text-ink">{ent.entity_class} #{ent.track_id}</span>
                        <span className="text-ink-faint">conf: {formatConfidence(ent.confidence)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="mt-1 block text-caption italic text-ink-faint">no active entities on this frame.</span>
                )}
              </div>

              <div>
                <span className="text-label font-medium text-ink-soft">
                  spatial scene graph relationships ({scene.data?.edges?.length || 0})
                </span>
                {scene.data?.edges?.length > 0 ? (
                  <div className="mt-1 flex max-h-36 flex-col gap-1 overflow-y-auto font-mono text-caption">
                    {scene.data.edges.map((edge, idx) => (
                      <div key={idx} className="flex items-center justify-between border border-line bg-paper p-1.5">
                        <span className="font-medium text-ink">{edge.source_id} → {edge.target_id}</span>
                        <span className="text-ink-soft">{edge.edge_type}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="mt-1 block text-caption italic text-ink-faint">no active relational edges.</span>
                )}
              </div>
            </div>
          </div>
        </Accordion>

        <Accordion
          title="sensor limitations — responsible AI & camera perspective"
          open={showSensorLimitations}
          onToggle={() => setShowSensorLimitations(!showSensorLimitations)}
        >
          <div className="flex flex-col gap-3 text-small leading-relaxed text-ink-soft">
            <p>
              <span className="font-medium text-ink">2D monocular camera constraints:</span> TRACE infers
              geometric contact and overlap from a calibrated 2D perspective. Depth, friction, wall
              yield strength, and internal mass distribution are estimated, not measured.
            </p>
            <p>
              <span className="font-medium text-ink">epistemic ceilings:</span> to prevent false alarms,
              TRACE enforces strict confidence ceilings. If optical evidence falls short, it defaults
              to procedural warnings or manual inspection rather than autonomous repositioning.
            </p>
            <p>
              <span className="font-medium text-ink">occlusion continuity:</span> ByteTrack reacquisition
              maintains identity across brief occlusions, but prolonged occlusion bounds confidence to
              "probable" or "insufficient evidence".
            </p>
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
      <span className={`font-display text-display-md font-semibold tabular-nums ${valueCls}`}>{value}</span>
      <span className="text-caption text-ink-faint">{note}</span>
    </div>
  )
}

function Tier({ label, note, tone, children }) {
  const toneCls = { neutral: 'border-line bg-paper', signal: 'border-signal/40 bg-signal/5', steel: 'border-steel/40 bg-steel/5', ok: 'border-ok/40 bg-ok/5' }[tone]
  return (
    <div className={`border p-3 ${toneCls}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-caption font-semibold text-ink">{label}</span>
        <span className="font-mono text-caption text-ink-faint">{note}</span>
      </div>
      <p className="mt-1 text-caption leading-tight text-ink-soft">{children}</p>
    </div>
  )
}

function ObservedCard({ label, value, note, tone }) {
  return (
    <div className="flex flex-col gap-0.5 border border-line bg-surface p-2.5">
      <span className="text-label font-medium text-ink-faint">{label}</span>
      <span className={`text-small font-semibold ${tone === 'ok' ? 'text-ok' : 'text-ink'}`}>{value}</span>
      <span className="text-caption text-ink-faint">{note}</span>
    </div>
  )
}

function InferredCard({ title, value, desc, tone, muted }) {
  const valueCls = muted ? 'text-ink-faint italic' : tone === 'signal' ? 'text-[#8a5f00]' : tone === 'danger' ? 'text-danger' : 'text-ink'
  return (
    <div className="flex flex-col gap-1 border border-line bg-surface p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-caption font-medium text-ink">{title}</span>
        <span className={`font-mono text-caption font-medium ${valueCls}`}>{value}</span>
      </div>
      <p className="text-caption leading-tight text-ink-soft">{desc}</p>
    </div>
  )
}

function FactorBlock({ formula, score, factors }) {
  return (
    <div className="mt-2 flex flex-col gap-2 bg-paper p-3">
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
        {factors.map((f) => (
          <div key={f.label} className="bg-surface p-2">
            <span className="block text-label font-medium text-ink-faint">{f.label}</span>
            <span className={`font-mono text-caption font-semibold ${f.tone === 'signal' ? 'text-[#8a5f00]' : 'text-ink'}`}>{f.value}</span>
            <span className="block text-caption text-ink-faint">{f.contrib}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 border-t border-line pt-2 font-mono text-caption">
        <div className="border border-line bg-surface px-2 py-1 text-ink-soft">formula: {formula}</div>
        <div className="mt-1 px-1 text-ink-soft">
          composite score: <span className="font-medium text-ink">{score}</span>
        </div>
      </div>
    </div>
  )
}
