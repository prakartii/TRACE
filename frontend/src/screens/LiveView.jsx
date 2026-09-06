import { useEffect, useRef, useState } from 'react'
import { getEntities, getFindings, getSamplingPolicy, getScene, getWhatIf, listVideos, streamUrl } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import FindingsPanel from '../components/video/FindingsPanel.jsx'
import HypotheticalOverlay from '../components/video/HypotheticalOverlay.jsx'
import LiveAnalysisSummary from '../components/video/LiveAnalysisSummary.jsx'
import MetadataPanel from '../components/video/MetadataPanel.jsx'
import PerceptionOverlay from '../components/video/PerceptionOverlay.jsx'
import SceneOverlay from '../components/video/SceneOverlay.jsx'
import VideoLibrary from '../components/video/VideoLibrary.jsx'
import VideoViewport from '../components/video/VideoViewport.jsx'
import WhatIfPanel from '../components/video/WhatIfPanel.jsx'
import { useOverlayData } from '../hooks/useOverlayData.js'

export default function LiveView() {
  const { setLiveState } = useLiveViewContext()

  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const [overlayEnabled, setOverlayEnabled] = useState(false)
  const [sceneEnabled, setSceneEnabled] = useState(false)
  const [findingsEnabled, setFindingsEnabled] = useState(false)
  const [pilotModelEnabled, setPilotModelEnabled] = useState(false)
  const [samplingPolicy, setSamplingPolicy] = useState(null)
  const [videoBoxSize, setVideoBoxSize] = useState({ width: 0, height: 0 })
  const [showMethodologyNotes, setShowMethodologyNotes] = useState(false)

  // Phase 7B: What-If simulation state
  const [whatIfSimulation, setWhatIfSimulation] = useState(null)
  const [whatIfLoading, setWhatIfLoading] = useState(false)
  const [whatIfError, setWhatIfError] = useState(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState(null)

  const videoRef = useRef(null)
  const modelName = pilotModelEnabled ? 'pilot' : 'stock'

  const perception = useOverlayData(getEntities, overlayEnabled, selectedId, currentTime, modelName)
  const scene = useOverlayData(getScene, sceneEnabled, selectedId, currentTime, modelName)
  const findings = useOverlayData(getFindings, findingsEnabled, selectedId, currentTime, modelName)

  // Sync current live state into shared context so PlannerView can consume it
  const selectedVideo = videos.find((v) => v.id === selectedId) ?? null
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
      const sim = await getWhatIf(selectedId, currentTime, finding.scenario, null, modelName)
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

  // Tracks the video element's actual displayed size so PerceptionOverlay
  // can scale source-resolution bbox coordinates into on-screen pixels
  // (SceneOverlay doesn't need this — it draws into an SVG viewBox sized
  // to the source resolution directly). Depends on `selectedId`, not
  // `[]`: the <video> element only exists once a video has loaded
  // (VideoViewport renders conditionally), so a mount-only effect would
  // capture a null ref and never re-attach.
  useEffect(() => {
    const el = videoRef.current
    if (!el) return undefined
    // Read the size synchronously up front too, not just on the first
    // ResizeObserver callback — keeps the overlay correctly scaled from
    // the first paint instead of one tick behind.
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
    // Clear What-If simulation on seek to ensure it remains frame-specific
    setWhatIfSimulation(null)
    setWhatIfError(null)
    // Immediately fetch new frame's data without waiting for throttle
    if (overlayEnabled) perception.fetchImmediate(newTime)
    if (sceneEnabled) scene.fetchImmediate(newTime)
    if (findingsEnabled) findings.fetchImmediate(newTime)
  }

  const entities = perception.data?.entities ?? []

  return (
    <div className="grid grid-cols-[1fr_280px] gap-6">
      <div>
        {/* Top-Level 4-Step Operational Summary */}
        <LiveAnalysisSummary
          video={selectedVideo}
          findings={findings.data}
          loading={findings.loading}
          findingsEnabled={findingsEnabled}
          currentTime={currentTime}
        />

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
              if (overlayEnabled) perception.fetchThrottled(t)
              if (sceneEnabled) scene.fetchThrottled(t)
              if (findingsEnabled) findings.fetchThrottled(t)
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          >
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
          <div className="flex h-64 items-center justify-center border border-line bg-white text-sm text-neutral-500">
            {loading ? 'Loading…' : 'No video selected.'}
          </div>
        )}

        {/* Operational Control Toggles */}
        <div className="mt-4 flex flex-col gap-2.5 border border-line bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs font-semibold text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={overlayEnabled}
                disabled={!selectedVideo}
                onChange={(event) => {
                  const checked = event.target.checked
                  setOverlayEnabled(checked)
                  if (checked) {
                    setPilotModelEnabled(true)
                  }
                }}
              />
              <span>Perception Overlay</span>
              <span className="text-[11px] font-normal text-neutral-500">— Detection & tracking</span>
            </label>
            <div className="flex items-center gap-2">
              {overlayEnabled && (perception.data?.analysis_fps || samplingPolicy?.analysis_fps) && (
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-mono font-bold tracking-wider rounded uppercase ${
                    (perception.data?.sampling_mode || samplingPolicy?.sampling_mode) === 'motion_dense'
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      : 'bg-neutral-100 text-neutral-700 border border-line'
                  }`}
                  title={samplingPolicy?.rationale || 'Adaptive analysis sampling rate'}
                >
                  {perception.data?.analysis_fps || samplingPolicy?.analysis_fps} FPS{' '}
                  {(perception.data?.sampling_mode || samplingPolicy?.sampling_mode) === 'motion_dense'
                    ? 'MOTION-DENSE'
                    : 'NORMAL'}
                </span>
              )}
              <span className="text-xs text-neutral-500">
                {perception.error
                  ? perception.error
                  : overlayEnabled && perception.loading
                    ? 'Running perception…'
                    : overlayEnabled
                      ? `${entities.length} object${entities.length === 1 ? '' : 's'} tracked`
                      : ''}
              </span>
            </div>
          </div>

          {(overlayEnabled || sceneEnabled) && (
            <div className="flex items-center justify-between border-t border-line pt-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={pilotModelEnabled}
                  onChange={(event) => setPilotModelEnabled(event.target.checked)}
                />
                <span>Pilot Model Fine-Tune</span>
                <span className="text-[11px] font-normal text-neutral-500">— Adds box + pallet</span>
              </label>
              {pilotModelEnabled && (
                <span className="flex items-center gap-2 text-[10px] text-neutral-500">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2" style={{ backgroundColor: '#18181b' }} />
                    person
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2" style={{ backgroundColor: '#b45309' }} />
                    box
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2" style={{ backgroundColor: '#4d7c0f' }} />
                    pallet
                  </span>
                </span>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-line pt-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={sceneEnabled}
                disabled={!selectedVideo}
                onChange={(event) => setSceneEnabled(event.target.checked)}
              />
              <span>Spatial Scene Graph</span>
              <span className="text-[11px] font-normal text-neutral-500">— Support & proximity relationships</span>
            </label>
            <span className="text-xs text-neutral-500">
              {scene.error
                ? scene.error
                : sceneEnabled && scene.loading
                  ? 'Computing…'
                  : sceneEnabled && scene.data
                    ? `${scene.data.nodes.length} nodes, ${scene.data.edges.length} edges`
                    : ''}
            </span>
          </div>

          <div className="flex items-center justify-between border-t border-line pt-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={findingsEnabled}
                disabled={!selectedVideo}
                onChange={(event) => setFindingsEnabled(event.target.checked)}
              />
              <span>Multi-Lens Risk Evaluation</span>
              <span className="text-[11px] font-normal text-neutral-500">— Behaviour, structural & conformance</span>
            </label>
            <span className="text-xs text-neutral-500">
              {findings.error
                ? findings.error
                : findingsEnabled && findings.loading
                  ? 'Evaluating…'
                  : findingsEnabled && findings.data
                    ? `${findings.data.length} finding${findings.data.length === 1 ? '' : 's'}`
                    : ''}
            </span>
          </div>

          {/* Progressive disclosure toggle for technical methodology */}
          <div className="border-t border-line pt-2">
            <button
              type="button"
              onClick={() => setShowMethodologyNotes(!showMethodologyNotes)}
              className="text-[10px] font-mono text-neutral-500 hover:text-ink flex items-center gap-1 cursor-pointer"
            >
              <span>{showMethodologyNotes ? '▼' : '▶'}</span>
              <span>{showMethodologyNotes ? 'Hide technical calibration & methodology notes' : 'View technical calibration & methodology notes'}</span>
            </button>
            {showMethodologyNotes && (
              <div className="mt-2 text-[11px] text-neutral-600 bg-neutral-50 p-2.5 border border-line flex flex-col gap-2">
                <p>
                  <strong>Pilot Model:</strong> Fine-tuned on 52 hand-annotated real frames — person detection is strong, box detection is operational, pallet detection did not learn reliably. See <code className="text-[10px]">training/README.md</code>.
                </p>
                <p>
                  <strong>Scene Graph Edges:</strong> Solid black = support hypothesis (image-space overlap), gray = contact, dashed = proximity. Geometric observations only; not definitive 3D contact. See <code className="text-[10px]">docs/WORLD_MODEL.md</code>.
                </p>
                <p>
                  <strong>Epistemic Safeguards:</strong> Findings are evidence-graded (SUPPORTED / PROBABLE / INSUFFICIENT EVIDENCE / UNSUPPORTED). A weak or uncalibrated observation never generates an ungrounded direct instruction. See <code className="text-[10px]">docs/RISK_LENSES.md</code>.
                </p>
              </div>
            )}
          </div>
        </div>

        {findingsEnabled && (
          <div className="mt-4 border border-line bg-white p-4">
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
          <div className="mt-4">
            <WhatIfPanel
              simulation={whatIfSimulation}
              loading={whatIfLoading}
              error={whatIfError}
              selectedCandidateId={selectedCandidateId}
              onSelectCandidate={setSelectedCandidateId}
              onClose={() => setWhatIfSimulation(null)}
            />
          </div>
        )}

        <div className="mt-4 border border-line bg-white p-4">
          <MetadataPanel video={selectedVideo} samplingPolicy={samplingPolicy} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Video sources
        </h2>
        <VideoLibrary
          videos={videos}
          selectedId={selectedId}
          onSelect={handleSelect}
          loading={loading}
          error={error}
        />
      </div>
    </div>
  )
}
