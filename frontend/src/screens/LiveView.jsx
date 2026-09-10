import { useEffect, useRef, useState } from 'react'
import { Loader2, ShieldCheck, Upload, Video } from 'lucide-react'
import { getAnalyzeStatus, getEntities, getFindings, getSamplingPolicy, getScene, getWhatIf, listVideos, streamUrl, uploadVideo } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import FindingsPanel from '../components/video/FindingsPanel.jsx'
import HypotheticalOverlay from '../components/video/HypotheticalOverlay.jsx'
import MetadataPanel from '../components/video/MetadataPanel.jsx'
import PerceptionOverlay from '../components/video/PerceptionOverlay.jsx'
import FaceRedactionOverlay from '../components/video/FaceRedactionOverlay.jsx'
import SceneOverlay from '../components/video/SceneOverlay.jsx'
import VideoLibrary from '../components/video/VideoLibrary.jsx'
import VideoViewport from '../components/video/VideoViewport.jsx'
import WhatIfPanel from '../components/video/WhatIfPanel.jsx'
import { useOverlayData } from '../hooks/useOverlayData.js'
import { getScenarioConfig, getVideoScenarioInfo } from '../lib/scenarios.js'

// Conceptual stages of the real backend sweep (perception -> four risk
// lenses -> planner -> incident persistence, backend/video/ingest.py).
// The backend only reports processing/complete/failed as a whole — there is
// no per-stage signal — so this list is a truthful description of what the
// pipeline is actually doing while we wait, cycled for visual feedback.
// It never claims a fake completion percentage or a specific stage as done.
const INGEST_STAGES = [
  'Reading footage',
  'Detecting activity',
  'Understanding behaviour',
  'Assessing safety',
  'Building incident timeline',
]

function formatTime(sec) {
  if (typeof sec !== 'number' || isNaN(sec)) return '00:00.0'
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1)
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`
}

export default function LiveView() {
  const { setLiveState, navigateTo, replayTarget } = useLiveViewContext()

  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const [overlayEnabled, setOverlayEnabled] = useState(true)
  const [sceneEnabled, setSceneEnabled] = useState(false)
  const [findingsEnabled, setFindingsEnabled] = useState(true)
  const [pilotModelEnabled, setPilotModelEnabled] = useState(true)
  const [samplingPolicy, setSamplingPolicy] = useState(null)
  const [videoBoxSize, setVideoBoxSize] = useState({ width: 0, height: 0 })
  const [showMethodologyNotes, setShowMethodologyNotes] = useState(false)

  const [whatIfSimulation, setWhatIfSimulation] = useState(null)
  const [whatIfLoading, setWhatIfLoading] = useState(false)
  const [whatIfError, setWhatIfError] = useState(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [ingestStatus, setIngestStatus] = useState(null) // status payload for the most recently uploaded video
  const [ingestStageIdx, setIngestStageIdx] = useState(0)

  const videoRef = useRef(null)
  const modelName = pilotModelEnabled ? 'pilot' : 'stock'

  // Always fetched: personnel boxes feed the by-default face redaction overlay,
  // independent of the `overlayEnabled` detection-box debug toggle.
  const perception = useOverlayData(getEntities, true, selectedId, currentTime, modelName)
  const scene = useOverlayData(getScene, sceneEnabled, selectedId, currentTime, modelName)
  const findings = useOverlayData(getFindings, findingsEnabled, selectedId, currentTime, modelName)

  const selectedVideo = videos.find((v) => v.id === selectedId) ?? null
  const videoInfo = selectedVideo ? getVideoScenarioInfo(selectedVideo.id || selectedVideo.filename) : null
  useEffect(() => {
    setLiveState({
      selectedId,
      selectedFilename: selectedVideo?.filename ?? null,
      currentTime,
      findings: findings.data,
      findingsLoading: findings.loading,
      findingsError: findings.error,
      modelName,
    })
  }, [selectedId, selectedVideo?.filename, currentTime, findings.data, findings.loading, findings.error, modelName, setLiveState])

  useEffect(() => {
    if (!selectedId) {
      setSamplingPolicy(null)
      return
    }
    let cancelled = false
    getSamplingPolicy(selectedId)
      .then((policy) => {
        if (!cancelled) setSamplingPolicy(policy)
      })
      .catch(() => {
        if (!cancelled) setSamplingPolicy(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  async function handleSimulateWhatIf(finding) {
    if (!selectedId) return
    setWhatIfLoading(true)
    setWhatIfError(null)
    try {
      const sim = await getWhatIf(selectedId, currentTime, finding.scenario, null, modelName, finding.entity_id)
      setWhatIfSimulation(sim)
      setSelectedCandidateId(sim.alternatives?.[0]?.id || null)
    } catch (err) {
      setWhatIfError(err.message)
    } finally {
      setWhatIfLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    listVideos()
      .then((list) => {
        if (cancelled) return
        setVideos(list)
        setSelectedId((current) => replayTarget?.videoId ?? current ?? list[0]?.id ?? null)
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (replayTarget?.videoId) {
      setSelectedId(replayTarget.videoId)
      if (replayTarget.timestamp !== undefined) {
        setCurrentTime(replayTarget.timestamp)
        if (videoRef.current) {
          videoRef.current.currentTime = replayTarget.timestamp
        }
      }
    }
  }, [replayTarget])

  async function handleUpload(file) {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    setIngestStatus(null)
    try {
      const uploaded = await uploadVideo(file)
      const refreshed = await listVideos()
      setVideos(refreshed)
      setSelectedId(uploaded.id)
      setPlaying(false)
      setCurrentTime(0)
      setWhatIfSimulation(null)
      setIngestStatus({ status: 'processing', video_id: uploaded.id })
    } catch (err) {
      setUploadError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // Poll the real backend ingestion sweep (backend/video/ingest.py) kicked
  // off on upload. No fake percentages — only the genuine processing /
  // complete / failed status and, once complete, the real scenario/event
  // counts it found.
  useEffect(() => {
    if (!ingestStatus || ingestStatus.status !== 'processing') return undefined
    let cancelled = false
    const poll = async () => {
      try {
        const s = await getAnalyzeStatus(ingestStatus.video_id)
        if (!cancelled) setIngestStatus(s)
      } catch {
        /* transient — keep polling */
      }
    }
    poll()
    const interval = setInterval(poll, 2500)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [ingestStatus?.video_id, ingestStatus?.status])

  // Cosmetic cycling through the real pipeline stages while processing —
  // not tied to a fabricated completion fraction (CLAUDE.md honesty rule).
  useEffect(() => {
    if (!ingestStatus || ingestStatus.status !== 'processing') return undefined
    const t = setInterval(() => {
      setIngestStageIdx((i) => (i + 1) % INGEST_STAGES.length)
    }, 1400)
    return () => clearInterval(t)
  }, [ingestStatus?.status])

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
  }, [selectedId])

  function handleSelect(id) {
    setSelectedId(id)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setWhatIfSimulation(null)
    setWhatIfError(null)
  }

  function handleTogglePlay() {
    const el = videoRef.current
    if (!el) return
    if (el.paused) {
      el.play()
    } else {
      el.pause()
    }
  }

  function handleSeekRatio(ratio) {
    const el = videoRef.current
    if (!el || !duration) return
    const newTime = ratio * duration
    el.currentTime = newTime
    setCurrentTime(newTime)
    setWhatIfSimulation(null)
    setWhatIfError(null)
    perception.fetchImmediate(newTime)
    if (sceneEnabled) scene.fetchImmediate(newTime)
    if (findingsEnabled) findings.fetchImmediate(newTime)
  }

  const entities = perception.data?.entities ?? []

  return (
    <div className="flex flex-col gap-6">

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-6">
        {/* Camera Bay Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-signal opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-signal"></span>
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-ink">
                  {videoInfo ? videoInfo.cameraName : 'Warehouse Camera Feed'}
                </h2>
                <span className="border border-line bg-paper px-2 py-0.5 text-label font-medium text-ink-soft">
                  {videoInfo?.zone || 'Warehouse'}
                </span>
              </div>
              <p className="text-caption text-ink-soft mt-0.5">
                {videoInfo?.scenarioTitle || 'Continuous live safety monitoring'}
                {currentTime !== undefined && (
                  <> · Position: <span className="font-mono tabular-nums text-ink">{formatTime(currentTime)}</span></>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {findings.loading ? (
              <span className="border border-signal/40 bg-signal/10 px-2.5 py-1 text-label font-medium text-[#8a5f00]">
                evaluating…
              </span>
            ) : findings.data && findings.data.length > 0 ? (
              <span className="border border-signal/40 bg-signal/10 px-2.5 py-1 text-label font-medium text-[#8a5f00]">
                {findings.data.length} Hazard Warning{findings.data.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="border border-ok/40 bg-ok/10 px-2.5 py-1 text-label font-medium text-ok">
                All Clear · Normal Operation
              </span>
            )}
          </div>
        </div>

        {selectedVideo ? (
          <VideoViewport
            ref={videoRef}
            src={streamUrl(selectedVideo.id)}
            playing={playing}
            currentTime={currentTime}
            duration={duration}
            onTogglePlay={handleTogglePlay}
            onSeekRatio={handleSeekRatio}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onTimeUpdate={(event) => {
              const t = event.currentTarget.currentTime
              setCurrentTime(t)
              if (whatIfSimulation && Math.abs(t - whatIfSimulation.timestamp) > 0.35) {
                setWhatIfSimulation(null)
                setWhatIfError(null)
              }
              perception.fetchThrottled(t)
              if (sceneEnabled) scene.fetchThrottled(t)
              if (findingsEnabled) findings.fetchThrottled(t)
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          >
            {/* Responsible AI: personnel faces obscured by default, independent
                of the detection-box debug toggle. Fails closed to a full-frame
                blur while detections are unavailable. */}
            <FaceRedactionOverlay
              entities={entities}
              sourceWidth={selectedVideo.metadata.width}
              sourceHeight={selectedVideo.metadata.height}
              displayWidth={videoBoxSize.width}
              displayHeight={videoBoxSize.height}
            />
            {overlayEnabled && (
              <PerceptionOverlay
                entities={entities}
                sourceWidth={selectedVideo.metadata.width}
                sourceHeight={selectedVideo.metadata.height}
                displayWidth={videoBoxSize.width}
                displayHeight={videoBoxSize.height}
              />
            )}
            {sceneEnabled && (
              <SceneOverlay
                snapshot={scene.data}
                sourceWidth={selectedVideo.metadata.width}
                sourceHeight={selectedVideo.metadata.height}
              />
            )}
            {whatIfSimulation?.current && (
              <HypotheticalOverlay
                candidate={
                  whatIfSimulation.alternatives?.find((c) => c.id === selectedCandidateId) ||
                  whatIfSimulation.alternatives?.[0]
                }
                current={whatIfSimulation.current}
                sourceWidth={selectedVideo.metadata.width}
                sourceHeight={selectedVideo.metadata.height}
              />
            )}
          </VideoViewport>
        ) : (
          <div className="flex h-64 items-center justify-center border border-line bg-surface text-small text-ink-soft">
            {loading ? 'Loading…' : 'No video selected.'}
          </div>
        )}

        {/* Compact Viewport Controls & Privacy Status */}
        <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface px-4 py-2 text-caption">
          <div className="flex items-center gap-4">
            <details className="relative">
              <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink select-none flex items-center gap-1.5">
                <span>Vision Overlays ({entities.length} tracked)</span>
                <span className="font-mono text-[10px]">▾</span>
              </summary>
              <div className="absolute left-0 top-full mt-1.5 z-20 w-64 border border-line bg-surface p-3 shadow-md space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={overlayEnabled}
                    disabled={!selectedVideo}
                    onChange={(e) => {
                      setOverlayEnabled(e.target.checked)
                      if (e.target.checked) setPilotModelEnabled(true)
                    }}
                    className="accent-ink"
                  />
                  <span className="font-medium text-ink">Object Detections</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sceneEnabled}
                    disabled={!selectedVideo}
                    onChange={(e) => setSceneEnabled(e.target.checked)}
                    className="accent-ink"
                  />
                  <span className="font-medium text-ink">Support &amp; Stacking Relations</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={findingsEnabled}
                    disabled={!selectedVideo}
                    onChange={(e) => setFindingsEnabled(e.target.checked)}
                    className="accent-ink"
                  />
                  <span className="font-medium text-ink">Active Hazard Evaluation</span>
                </label>
              </div>
            </details>

            <span className="text-ink-faint">|</span>

            <span className="flex items-center gap-1.5 text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              <span>Face Privacy Active</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigateTo('Incident Replay', { videoId: selectedId, timestamp: currentTime })}
              className="font-semibold text-ink hover:underline text-caption cursor-pointer"
            >
              Investigate Incident Evidence (Step 3) →
            </button>
          </div>
        </div>

        {findingsEnabled && (
          <FindingsPanel
            findings={findings.data}
            loading={findings.loading}
            error={findings.error}
            currentTime={currentTime}
            onSimulateWhatIf={handleSimulateWhatIf}
            onReviewHazard={() => navigateTo('Incidents', { videoId: selectedId, timestamp: currentTime })}
            onReplayIncident={() => navigateTo('Incident Replay', { videoId: selectedId, timestamp: currentTime })}
          />
        )}

        {(whatIfSimulation || whatIfLoading || whatIfError) && (
          <WhatIfPanel
            simulation={whatIfSimulation}
            loading={whatIfLoading}
            error={whatIfError}
            selectedCandidateId={selectedCandidateId}
            onSelectCandidate={setSelectedCandidateId}
            onClose={() => setWhatIfSimulation(null)}
            onOpenReplay={() =>
              navigateTo('What-If Simulation', { videoId: selectedId, timestamp: currentTime })
            }
          />
        )}

        {selectedVideo && (
          <details className="border border-line bg-surface p-3 text-caption">
            <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink select-none">
              Camera Specifications &amp; Stream Details
            </summary>
            <div className="mt-3 pt-3 border-t border-line">
              <MetadataPanel video={selectedVideo} samplingPolicy={samplingPolicy} />
            </div>
          </details>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <Video size={15} className="text-ink-soft" />
          <h2 className="text-small font-semibold text-ink">Monitored Cameras</h2>
        </div>
        <VideoLibrary
          videos={videos}
          selectedId={selectedId}
          onSelect={handleSelect}
          loading={loading}
          error={error}
        />

        <label className="mt-3 flex cursor-pointer flex-col items-center gap-1 border border-dashed border-line bg-surface p-4 text-center transition-colors hover:border-line-strong">
          <input
            type="file"
            accept="video/mp4,.mp4"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleUpload(file)
              e.target.value = ''
            }}
          />
          <Upload size={15} className="text-ink-soft" />
          <span className="text-caption font-medium text-ink">
            {uploading ? 'Uploading…' : 'Add camera footage'}
          </span>
          <span className="text-caption text-ink-faint">
            Drop in an MP4 — TRACE runs the full detection &amp; risk sweep automatically
          </span>
        </label>
        {uploadError && (
          <p className="mt-2 border border-danger bg-danger/5 p-2 text-caption text-danger">{uploadError}</p>
        )}

        {ingestStatus?.status === 'processing' && (
          <div className="mt-2 border border-line bg-paper p-3">
            <div className="flex items-center gap-2 text-caption font-bold uppercase tracking-wider text-ink">
              <Loader2 size={13} className="animate-spin text-accent" />
              Processing Video
            </div>
            <ul className="mt-2 space-y-1">
              {INGEST_STAGES.map((stage, i) => (
                <li
                  key={stage}
                  className={`flex items-center gap-1.5 text-caption ${
                    i === ingestStageIdx ? 'font-semibold text-ink' : 'text-ink-faint'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${i === ingestStageIdx ? 'bg-accent' : 'bg-line-strong'}`} />
                  {stage}
                </li>
              ))}
            </ul>
          </div>
        )}

        {ingestStatus?.status === 'complete' && (
          <div className="mt-2 border border-ok/40 bg-ok/5 p-3">
            <div className="flex items-center gap-2 text-caption font-bold uppercase tracking-wider text-ok">
              <ShieldCheck size={13} />
              Analysis Complete
            </div>
            <p className="mt-1 text-caption text-ink">
              {ingestStatus.events_found > 0
                ? `${ingestStatus.events_found} safety event${ingestStatus.events_found === 1 ? '' : 's'} detected across ${ingestStatus.scenarios?.length ?? 0} scenario${ingestStatus.scenarios?.length === 1 ? '' : 's'}.`
                : (ingestStatus.message || 'No supported safety scenario detected in this video.')}
            </p>
            {ingestStatus.scenarios?.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {ingestStatus.scenarios.slice(0, 6).map((s) => (
                  <li key={s.scenario} className="text-caption text-ink-soft">
                    · {getScenarioConfig(s.scenario).title} ({s.band}, {s.count})
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {ingestStatus?.status === 'failed' && (
          <div className="mt-2 border border-danger bg-danger/5 p-3 text-caption text-danger">
            Analysis failed: {ingestStatus.error || 'unknown error'}
          </div>
        )}
      </div>
    </div>
    </div>
  )
}


