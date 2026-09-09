import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { getEvent } from '../api/events.js'
import { getActionPlan } from '../api/actions.js'
import { getEventOutcome, verifyEventOutcome } from '../api/measurement.js'
import { getEntities, getScene, getVideo, streamUrl } from '../api/videos.js'
import { useOverlayData } from '../hooks/useOverlayData.js'
import VideoViewport from '../components/video/VideoViewport.jsx'
import SceneOverlay from '../components/video/SceneOverlay.jsx'
import FaceRedactionOverlay from '../components/video/FaceRedactionOverlay.jsx'
import SafeActionPanel from '../components/monitor/SafeActionPanel.jsx'
import OutcomeCheck from '../components/incidents/OutcomeCheck.jsx'
import ReviewActions from '../components/incidents/ReviewActions.jsx'
import {
  formatEvidenceKey,
  formatEvidenceValue,
  formatTimestamp,
  getScenarioConfig,
  getVideoScenarioInfo,
  telemetryEntries,
} from '../lib/scenarios.js'

const BAND_TEXT = { Critical: 'text-crit', High: 'text-high', Medium: 'text-dim', Low: 'text-mute' }
const TABS = [
  ['overview', 'Overview', ''],
  ['replay', 'Replay', '/replay'],
  ['what-if', 'What-If', '/what-if'],
]

export default function IncidentDetail() {
  const { id } = useParams()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const tab = pathname.split('/')[3] || 'overview'

  const [event, setEvent] = useState(null)
  const [plan, setPlan] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const [video, setVideo] = useState(null)
  const [error, setError] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [showScene, setShowScene] = useState(false)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const videoRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setEvent(null)
    Promise.all([
      getEvent(id),
      getActionPlan(id).catch(() => null),
      getEventOutcome(id).catch(() => null),
    ])
      .then(([ev, pl, oc]) => {
        if (cancelled) return
        setEvent(ev)
        setPlan(pl)
        setOutcome(oc)
        if (ev?.video_id) getVideo(ev.video_id).then((v) => !cancelled && setVideo(v)).catch(() => {})
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [id])

  const ts = event?.timestamp ?? 0
  const entities = useOverlayData(getEntities, tab === 'replay', event?.video_id, ts, 'pilot')
  const scene = useOverlayData(getScene, tab === 'replay' && showScene, event?.video_id, ts, 'pilot')

  useEffect(() => {
    const el = videoRef.current
    if (!el) return undefined
    const sync = () => setBox({ width: el.clientWidth, height: el.clientHeight })
    sync()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tab, video])

  const normalizedPlan = useMemo(() => {
    if (!plan) return null
    return {
      action: plan.immediate_action,
      rationale: plan.reason,
      steps: plan.steps || [],
      verification: plan.verification,
      limitations: plan.limitations || [],
      whatIfEligible: plan.what_if_eligible,
    }
  }, [plan])

  async function handleVerify() {
    setVerifying(true)
    try {
      setOutcome(await verifyEventOutcome(id))
    } catch {
      /* leave outcome null; OutcomeCheck keeps the verify button */
    } finally {
      setVerifying(false)
    }
  }

  if (error) return <p className="text-caption text-crit">[error] {error}</p>
  if (!event) return <p className="text-caption text-mute">loading…</p>

  const cfg = getScenarioConfig(event.scenario)
  const band = event.band || cfg.defaultBand || 'Medium'
  const cam = getVideoScenarioInfo(event.video_id).cameraName || event.video_id
  const evidence = event.evidence || {}
  const metrics = telemetryEntries(evidence)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-page font-semibold">
          <span className="font-mono text-dim">#{event.event_id}</span> {cfg.title}
        </h1>
        <span className="font-mono text-caption">
          <span className={`font-semibold tracking-[0.04em] ${BAND_TEXT[band] || 'text-dim'}`}>
            {band.toUpperCase()}
          </span>
          <span className="text-mute"> · {event.status}</span>
        </span>
      </div>

      <div className="flex gap-1 border-b border-line">
        {TABS.map(([key, label, suffix]) => (
          <Link
            key={key}
            to={`/incidents/${id}${suffix}`}
            className={`border-b-2 px-3 py-2 text-caption transition-colors ${
              tab === key
                ? 'border-ink font-semibold text-ink'
                : 'border-transparent text-mute hover:text-dim'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-caption">
            <dt className="text-mute">camera</dt>
            <dd>{cam}</dd>
            <dt className="text-mute">time</dt>
            <dd className="font-mono">{formatTimestamp(ts)}</dd>
            <dt className="text-mute">lens</dt>
            <dd>{event.lens}</dd>
            <dt className="text-mute">confidence</dt>
            <dd>{String(event.confidence || '').toLowerCase()}</dd>
          </dl>

          {event.explanation && (
            <div className="panel">
              <span className="eyebrow mb-2 block">Why this matters</span>
              <p className="text-body text-dim">{event.explanation}</p>
            </div>
          )}

          <SafeActionPanel title={cfg.title} plan={normalizedPlan} finding={event} />

          {metrics.length > 0 && (
            <details className="panel">
              <summary className="eyebrow cursor-pointer">Recorded evidence</summary>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                {metrics.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-label text-mute">{formatEvidenceKey(k)}</dt>
                    <dd className="font-mono text-caption tabular-nums">{formatEvidenceValue(k, v)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}

          <p className="text-caption">
            <span className="eyebrow mr-1.5">outcome</span>
            {outcome ? (
              <span className={outcome.classification === 'prevented' ? 'text-ok' : 'text-dim'}>
                {outcome.classification.replace(/_/g, ' ')}
                {outcome.classification === 'prevented' ? ' ✓' : ''}
              </span>
            ) : (
              <span className="text-mute">not verified</span>
            )}
          </p>
        </div>
      )}

      {tab === 'replay' && (
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-1.5 text-caption text-dim">
            <input
              type="checkbox"
              checked={showScene}
              onChange={(e) => setShowScene(e.target.checked)}
              className="accent-ink"
            />
            scene overlay
          </label>

          {video ? (
            <VideoViewport
              ref={videoRef}
              src={streamUrl(video.id)}
              playing={false}
              currentTime={ts}
              duration={video.metadata?.duration || 0}
              onTogglePlay={() => {
                const el = videoRef.current
                if (el) el.paused ? el.play() : el.pause()
              }}
              onSeekRatio={(r) => {
                const el = videoRef.current
                if (el && video.metadata?.duration) el.currentTime = r * video.metadata.duration
              }}
              onLoadedMetadata={() => {
                const el = videoRef.current
                if (el) el.currentTime = ts
              }}
            >
              <FaceRedactionOverlay
                entities={entities.data?.entities ?? []}
                degraded={!entities.data || !!entities.error}
                sourceWidth={video.metadata.width}
                sourceHeight={video.metadata.height}
                displayWidth={box.width}
                displayHeight={box.height}
              />
              {showScene && (
                <SceneOverlay
                  snapshot={scene.data}
                  sourceWidth={video.metadata.width}
                  sourceHeight={video.metadata.height}
                />
              )}
            </VideoViewport>
          ) : (
            <div className="flex h-56 items-center justify-center rounded-md border border-line bg-raised text-caption text-mute">
              loading video…
            </div>
          )}

          <p className="text-label text-mute">
            Face redaction is on by default; the still-frame endpoint fails closed, the streamed
            view falls back to a full-frame blur when detections are unavailable.
          </p>

          <OutcomeCheck outcome={outcome} verifying={verifying} onVerify={handleVerify} />
          <ReviewActions
            eventId={id}
            current={event.review_status}
            onReviewed={(updated) => setEvent((e) => ({ ...e, ...updated }))}
          />
        </div>
      )}

      {tab === 'what-if' && (
        <div className="panel">
          <span className="eyebrow mb-2 block">What-If</span>
          <p className="mb-3 text-caption text-dim">
            The observed-vs-simulated trajectory is being folded into this tab in phase 2. For
            now it opens in the standalone What-If screen.
          </p>
          <button
            type="button"
            onClick={() =>
              navigate('/what-if', {
                state: {
                  replayTarget: {
                    eventId: Number(id),
                    videoId: event.video_id,
                    timestamp: ts,
                    event,
                  },
                },
              })
            }
            className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-caption text-dim hover:text-ink"
          >
            open What-If for #{id} →
          </button>
        </div>
      )}
    </div>
  )
}
