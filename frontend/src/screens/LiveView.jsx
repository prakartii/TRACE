import { useEffect, useRef, useState } from 'react'
import { Video } from 'lucide-react'
import { getEntities, getFindings, getSamplingPolicy, getScene, getWhatIf, listVideos, streamUrl } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import FindingsPanel from '../components/video/FindingsPanel.jsx'
import HypotheticalOverlay from '../components/video/HypotheticalOverlay.jsx'
import LiveAnalysisSummary from '../components/video/LiveAnalysisSummary.jsx'
import MetadataPanel from '../components/video/MetadataPanel.jsx'
import PerceptionOverlay from '../components/video/PerceptionOverlay.jsx'
import FaceRedactionOverlay from '../components/video/FaceRedactionOverlay.jsx'
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

  const videoRef = useRef(null)
  const modelName = pilotModelEnabled ? 'pilot' : 'stock'

  // Always fetched: personnel boxes feed the by-default face redaction overlay,
  // independent of the `overlayEnabled` detection-box debug toggle.
  const perception = useOverlayData(getEntities, true, selectedId, currentTime, modelName)
  const scene = useOverlayData(getScene, sceneEnabled, selectedId, currentTime, modelName)
  const findings = useOverlayData(getFindings, findingsEnabled, selectedId, currentTime, modelName)

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
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-6">
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
          <p className="border border-line border-t-0 bg-surface px-3 py-1.5 font-mono text-[10px] text-ink-faint">
            Responsible AI: personnel faces are obscured. The exported still frame is redacted
            server-side (fails closed); this streamed view redacts at the presentation layer and
            falls back to a full-frame blur when detections are unavailable.
          </p>
        )}

        {/* controls */}
        <div className="flex flex-col border border-line bg-surface">
          <ToggleRow
            label="perception overlay"
            hint="detection & tracking"
            checked={overlayEnabled}
            disabled={!selectedVideo}
            onChange={(checked) => {
              setOverlayEnabled(checked)
              if (checked) setPilotModelEnabled(true)
            }}
            right={
              <span className="text-caption text-ink-faint">
                {perception.error
                  ? perception.error
                  : overlayEnabled && perception.loading
                    ? 'running perception…'
                    : overlayEnabled
                      ? `${entities.length} object${entities.length === 1 ? '' : 's'} tracked`
                      : ''}
              </span>
            }
          />

          {overlayEnabled && (perception.data?.analysis_fps || samplingPolicy?.analysis_fps) && (
            <div className="flex items-center justify-between border-t border-line px-4 py-1.5">
              <span className="text-caption text-ink-faint">adaptive sampling</span>
              <span className="font-mono text-caption text-ink">
                {perception.data?.analysis_fps || samplingPolicy?.analysis_fps} fps ·{' '}
                {(perception.data?.sampling_mode || samplingPolicy?.sampling_mode) === 'motion_dense'
                  ? 'motion-dense'
                  : 'normal'}
              </span>
            </div>
          )}

          {(overlayEnabled || sceneEnabled) && (
            <>
              <ToggleRow
                label="pilot model fine-tune"
                hint="adds box + pallet"
                checked={pilotModelEnabled}
                onChange={setPilotModelEnabled}
                right={
                  pilotModelEnabled && (
                    <span className="flex items-center gap-3 text-caption text-ink-soft">
                      <LegendDot color="bg-ink" label="person" />
                      <LegendDot color="bg-signal" label="box" />
                      <LegendDot color="bg-ok" label="pallet" />
                    </span>
                  )
                }
              />
            </>
          )}

          <ToggleRow
            label="spatial scene graph"
            hint="support & proximity relationships"
            checked={sceneEnabled}
            disabled={!selectedVideo}
            onChange={setSceneEnabled}
            right={
              <span className="text-caption text-ink-faint">
                {scene.error
                  ? scene.error
                  : sceneEnabled && scene.loading
                    ? 'computing…'
                    : sceneEnabled && scene.data
                      ? `${scene.data.nodes.length} nodes, ${scene.data.edges.length} edges`
                      : ''}
              </span>
            }
          />

          <ToggleRow
            label="multi-lens risk evaluation"
            hint="behaviour, structural & conformance"
            checked={findingsEnabled}
            disabled={!selectedVideo}
            onChange={setFindingsEnabled}
            right={
              <span className="text-caption text-ink-faint">
                {findings.error
                  ? findings.error
                  : findingsEnabled && findings.loading
                    ? 'evaluating…'
                    : findingsEnabled && findings.data
                      ? `${findings.data.length} finding${findings.data.length === 1 ? '' : 's'}`
                      : ''}
              </span>
            }
          />

          <div className="border-t border-line">
            <button
              type="button"
              onClick={() => setShowMethodologyNotes(!showMethodologyNotes)}
              className="flex w-full items-center justify-between px-4 py-2 text-caption text-ink-soft transition-colors hover:text-ink"
            >
              <span>technical calibration & methodology notes</span>
              <span className="font-mono">{showMethodologyNotes ? '−' : '+'}</span>
            </button>
            {showMethodologyNotes && (
              <div className="flex flex-col gap-2 border-t border-line bg-paper p-3 text-caption text-ink-soft">
                <p>
                  <span className="font-medium text-ink">pilot model:</span> fine-tuned on 52
                  hand-annotated real frames — person detection is strong, box detection is
                  operational, pallet detection did not learn reliably.
                </p>
                <p>
                  <span className="font-medium text-ink">scene graph edges:</span> solid black =
                  support hypothesis, gray = contact, dashed = proximity. Geometric observations
                  only, not definitive 3D contact.
                </p>
                <p>
                  <span className="font-medium text-ink">epistemic safeguards:</span> findings are
                  evidence-graded (supported / probable / insufficient evidence / unsupported). A
                  weak observation never generates an ungrounded instruction.
                </p>
              </div>
            )}
          </div>
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
          />
        )}

        <div className="border border-line bg-surface p-4">
          <MetadataPanel video={selectedVideo} samplingPolicy={samplingPolicy} />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <Video size={15} className="text-ink-soft" />
          <h2 className="text-small font-semibold text-ink">video sources</h2>
        </div>
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

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 ${color}`} />
      {label}
    </span>
  )
}

function ToggleRow({ label, hint, checked, onChange, disabled, right }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-2.5 first:border-t-0">
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-ink"
        />
        <span className="text-small font-medium text-ink">{label}</span>
        {hint && <span className="text-caption text-ink-faint">— {hint}</span>}
      </label>
      {right}
    </div>
  )
}
