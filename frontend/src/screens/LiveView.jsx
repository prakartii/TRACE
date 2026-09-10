import { useEffect, useRef, useState } from 'react'
import { Upload, Video } from 'lucide-react'
import { getEntities, getFindings, getSamplingPolicy, getScene, getWhatIf, listVideos, streamUrl, uploadVideo } from '../api/videos.js'
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
import LiveCameraPanel from '../components/video/LiveCameraPanel.jsx'
import { useOverlayData } from '../hooks/useOverlayData.js'
import { getVideoScenarioInfo } from '../lib/scenarios.js'
import WorkflowNav from '../components/WorkflowNav.jsx'

function formatTime(sec) {
  if (typeof sec !== 'number' || isNaN(sec)) return '00:00.0'
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1)
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`
}

export default function LiveView() {
  const { setLiveState, navigateTo } = useLiveViewContext()

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
        setSelectedId((current) => current ?? list[0]?.id ?? null)
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  async function handleUpload(file) {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const uploaded = await uploadVideo(file)
      const refreshed = await listVideos()
      setVideos(refreshed)
      setSelectedId(uploaded.id)
      setPlaying(false)
      setCurrentTime(0)
      setWhatIfSimulation(null)
    } catch (err) {
      setUploadError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

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
      {/* 5-step safety workflow banner */}
      <WorkflowNav
        currentStep={1}
        navigateTo={navigateTo}
        context={{ videoId: selectedId, timestamp: currentTime }}
      />

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
              degraded={!perception.data || !!perception.error}
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

        {selectedVideo && (
          <div className="flex items-center justify-between border border-line border-t-0 bg-surface px-3 py-1.5 text-caption text-ink-soft">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-ok" />
              <span className="font-medium text-ink">Worker Privacy Active:</span>
              <span>Personnel faces obscured by default</span>
            </span>
            <span className="font-mono text-[11px] text-ink-faint">live stream</span>
          </div>
        )}

        {/* Streamlined Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border border-line bg-surface px-4 py-2.5 text-caption">
          <div className="flex flex-wrap items-center gap-6">
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
              <span className="font-medium text-ink">Object Detection</span>
              <span className="text-ink-faint">({entities.length} tracked)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sceneEnabled}
                disabled={!selectedVideo}
                onChange={(e) => setSceneEnabled(e.target.checked)}
                className="accent-ink"
              />
              <span className="font-medium text-ink">Stacking &amp; Alignment Overlays</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={findingsEnabled}
                disabled={!selectedVideo}
                onChange={(e) => setFindingsEnabled(e.target.checked)}
                className="accent-ink"
              />
              <span className="font-medium text-ink">Live Hazard Warnings</span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => navigateTo('Incident Replay', { videoId: selectedId })}
            className="font-medium text-ink-soft hover:text-ink hover:underline text-caption"
          >
            Replay in Forensics →
          </button>
        </div>

        {findingsEnabled && (
          <div className="border border-line bg-surface p-4">
            <FindingsPanel
              findings={findings.data}
              loading={findings.loading}
              error={findings.error}
              currentTime={currentTime}
              onSimulateWhatIf={handleSimulateWhatIf}
            />
          </div>
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
            {uploading ? 'Ingesting footage…' : 'Add camera footage'}
          </span>
          <span className="text-caption text-ink-faint">
            Drop in an MP4 — detection &amp; risk analysis run automatically
          </span>
        </label>
        {uploadError && (
          <p className="mt-2 border border-danger bg-danger/5 p-2 text-caption text-danger">{uploadError}</p>
        )}

        <LiveCameraPanel />
      </div>
    </div>
    </div>
  )
}


