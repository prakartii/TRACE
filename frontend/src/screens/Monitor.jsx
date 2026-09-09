import { useEffect, useMemo, useRef, useState } from 'react'
import { getEntities, getFindings, getScene, listVideos, streamUrl } from '../api/videos.js'
import { getTemporalSummary } from '../api/temporal.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import { useOverlayData } from '../hooks/useOverlayData.js'
import VideoViewport from '../components/video/VideoViewport.jsx'
import PerceptionOverlay from '../components/video/PerceptionOverlay.jsx'
import SceneOverlay from '../components/video/SceneOverlay.jsx'
import FaceRedactionOverlay from '../components/video/FaceRedactionOverlay.jsx'
import RiskList, { findingKey } from '../components/monitor/RiskList.jsx'
import SafeActionPanel from '../components/monitor/SafeActionPanel.jsx'
import { getScenarioConfig, getVideoScenarioInfo } from '../lib/scenarios.js'

const MODEL = 'pilot'

export default function Monitor() {
  const { setLiveState, navigateTo } = useLiveViewContext()

  const [videos, setVideos] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loadError, setLoadError] = useState(null)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [box, setBox] = useState({ width: 0, height: 0 })

  const [showBoxes, setShowBoxes] = useState(true)
  const [showScene, setShowScene] = useState(false)

  const [selectedRiskKey, setSelectedRiskKey] = useState(null)
  const [likelyNext, setLikelyNext] = useState(null)

  const videoRef = useRef(null)

  const perception = useOverlayData(getEntities, true, selectedId, currentTime, MODEL)
  const scene = useOverlayData(getScene, showScene, selectedId, currentTime, MODEL)
  const findings = useOverlayData(getFindings, true, selectedId, currentTime, MODEL)

  const selectedVideo = videos.find((v) => v.id === selectedId) ?? null
  const entities = perception.data?.entities ?? []
  const findingList = findings.data ?? []

  useEffect(() => {
    let cancelled = false
    listVideos()
      .then((list) => {
        if (cancelled) return
        setVideos(list)
        setSelectedId((cur) => cur ?? list[0]?.id ?? null)
      })
      .catch((err) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the shared bridge state in sync (Safe Action / old screens read it).
  useEffect(() => {
    setLiveState({
      selectedId,
      selectedFilename: selectedVideo?.filename ?? null,
      currentTime,
      findings: findings.data,
      findingsLoading: findings.loading,
      findingsError: findings.error,
      modelName: MODEL,
    })
  }, [selectedId, selectedVideo?.filename, currentTime, findings.data, findings.loading, findings.error, setLiveState])

  // One-line "what's likely next" — only shown when a prediction actually exists.
  useEffect(() => {
    if (!selectedId) return setLikelyNext(null)
    let cancelled = false
    getTemporalSummary({ video_id: selectedId })
      .then((s) => {
        if (cancelled) return
        const p = s?.top_prediction
        setLikelyNext(p ? p.summary || p.description || p.scenario || null : null)
      })
      .catch(() => !cancelled && setLikelyNext(null))
    return () => {
      cancelled = true
    }
  }, [selectedId])

  // Track the display size of the <video> so overlays can scale.
  useEffect(() => {
    const el = videoRef.current
    if (!el) return undefined
    setBox({ width: el.clientWidth, height: el.clientHeight })
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([e]) => e && setBox({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [selectedId])

  function selectVideo(id) {
    setSelectedId(id)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setSelectedRiskKey(null)
  }

  function togglePlay() {
    const el = videoRef.current
    if (!el) return
    el.paused ? el.play() : el.pause()
  }

  function seekRatio(ratio) {
    const el = videoRef.current
    if (!el || !duration) return
    const t = ratio * duration
    el.currentTime = t
    setCurrentTime(t)
    perception.fetchImmediate(t)
    if (showScene) scene.fetchImmediate(t)
    findings.fetchImmediate(t)
  }

  const selectedFinding = useMemo(
    () => findingList.find((f) => findingKey(f) === selectedRiskKey) ?? null,
    [findingList, selectedRiskKey],
  )

  // Auto-select the top-ranked risk when none is chosen.
  useEffect(() => {
    if (!selectedRiskKey && findingList.length > 0) {
      setSelectedRiskKey(findingKey(findingList[0]))
    }
  }, [findingList, selectedRiskKey])

  const plan = useMemo(() => {
    const fp = selectedFinding?.planner_recommendation
    if (!fp) return null
    return {
      action: fp.action,
      rationale: fp.rationale,
      steps: [],
      limitations: fp.limitations || [],
      whatIfEligible: fp.what_if_eligible,
    }
  }, [selectedFinding])

  const cameraName = selectedVideo
    ? getVideoScenarioInfo(selectedVideo.id).cameraName || selectedVideo.filename
    : ''

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-page font-semibold">Monitor</h1>
        {selectedVideo && <span className="text-caption text-mute">{cameraName}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-caption text-dim">
          camera
          <select
            value={selectedId ?? ''}
            onChange={(e) => selectVideo(e.target.value)}
            className="rounded border border-line-strong bg-bg px-2 py-1 text-caption text-ink focus:border-ink"
          >
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {getVideoScenarioInfo(v.id).cameraName || v.filename}
              </option>
            ))}
          </select>
        </label>
        <span className="text-caption text-dim">overlays:</span>
        <label className="flex items-center gap-1.5 text-caption text-dim">
          <input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} className="accent-ink" />
          boxes
        </label>
        <label className="flex items-center gap-1.5 text-caption text-dim">
          <input type="checkbox" checked={showScene} onChange={(e) => setShowScene(e.target.checked)} className="accent-ink" />
          scene
        </label>
        <span className="text-caption text-mute" title="Personnel faces are obscured by default and cannot be turned off.">
          faces: blurred (locked)
        </span>
      </div>

      {loadError && <p className="text-caption text-crit">[error] {loadError}</p>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-3">
          {selectedVideo ? (
            <VideoViewport
              ref={videoRef}
              src={streamUrl(selectedVideo.id)}
              playing={playing}
              currentTime={currentTime}
              duration={duration}
              onTogglePlay={togglePlay}
              onSeekRatio={seekRatio}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime
                setCurrentTime(t)
                perception.fetchThrottled(t)
                if (showScene) scene.fetchThrottled(t)
                findings.fetchThrottled(t)
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            >
              <FaceRedactionOverlay
                entities={entities}
                degraded={!perception.data || !!perception.error}
                sourceWidth={selectedVideo.metadata.width}
                sourceHeight={selectedVideo.metadata.height}
                displayWidth={box.width}
                displayHeight={box.height}
              />
              {showBoxes && (
                <PerceptionOverlay
                  entities={entities}
                  sourceWidth={selectedVideo.metadata.width}
                  sourceHeight={selectedVideo.metadata.height}
                  displayWidth={box.width}
                  displayHeight={box.height}
                />
              )}
              {showScene && (
                <SceneOverlay
                  snapshot={scene.data}
                  sourceWidth={selectedVideo.metadata.width}
                  sourceHeight={selectedVideo.metadata.height}
                />
              )}
            </VideoViewport>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-md border border-line bg-raised text-caption text-mute">
              Loading…
            </div>
          )}

          <p className="text-label text-mute">
            Personnel faces are obscured. The exported still frame is redacted server-side and fails
            closed; this streamed view redacts at the presentation layer and falls back to a
            full-frame blur when detections are unavailable.
          </p>

          {likelyNext && (
            <p className="text-caption text-dim">
              <span className="eyebrow mr-1.5">likely next</span>
              {likelyNext}
            </p>
          )}

          {selectedFinding && (
            <SafeActionPanel
              title={getScenarioConfig(selectedFinding.scenario).title}
              plan={plan}
              finding={selectedFinding}
              onSimulate={() =>
                navigateTo('What-If Simulation', {
                  videoId: selectedId,
                  timestamp: currentTime,
                  scenario: selectedFinding.scenario,
                })
              }
            />
          )}
        </div>

        <RiskList
          findings={findingList}
          loading={findings.loading}
          error={findings.error}
          selectedKey={selectedRiskKey}
          onSelect={(_f, key) => setSelectedRiskKey(key)}
        />
      </div>
    </div>
  )
}
