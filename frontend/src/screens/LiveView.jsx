import { useEffect, useRef, useState } from 'react'
import { getEntities, getFindings, getScene, listVideos, streamUrl } from '../api/videos.js'
import FindingsPanel from '../components/video/FindingsPanel.jsx'
import MetadataPanel from '../components/video/MetadataPanel.jsx'
import PerceptionOverlay from '../components/video/PerceptionOverlay.jsx'
import SceneOverlay from '../components/video/SceneOverlay.jsx'
import VideoLibrary from '../components/video/VideoLibrary.jsx'
import VideoViewport from '../components/video/VideoViewport.jsx'
import { useOverlayData } from '../hooks/useOverlayData.js'

export default function LiveView() {
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
  const [videoBoxSize, setVideoBoxSize] = useState({ width: 0, height: 0 })

  const videoRef = useRef(null)
  const modelName = pilotModelEnabled ? 'pilot' : 'stock'

  const perception = useOverlayData(getEntities, overlayEnabled, selectedId, currentTime, modelName)
  const scene = useOverlayData(getScene, sceneEnabled, selectedId, currentTime, modelName)
  const findings = useOverlayData(getFindings, findingsEnabled, selectedId, currentTime, modelName)

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
    el.currentTime = ratio * duration
    setCurrentTime(el.currentTime)
  }

  const selectedVideo = videos.find((video) => video.id === selectedId) ?? null
  const entities = perception.data?.entities ?? []

  return (
    <div className="grid grid-cols-[1fr_280px] gap-6">
      <div>
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
          </VideoViewport>
        ) : (
          <div className="flex h-64 items-center justify-center border border-line bg-white text-sm text-neutral-500">
            {loading ? 'Loading…' : 'No video selected.'}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 border border-line bg-white px-4 py-2.5">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={overlayEnabled}
                disabled={!selectedVideo}
                onChange={(event) => setOverlayEnabled(event.target.checked)}
              />
              Perception overlay (detection + tracking)
            </label>
            <span className="text-xs text-neutral-500">
              {perception.error
                ? perception.error
                : overlayEnabled && perception.loading
                  ? 'Running detection on this video (first look can take up to ~1 min; cached after that)…'
                  : overlayEnabled
                    ? `${entities.length} object${entities.length === 1 ? '' : 's'} detected at this frame`
                    : ''}
            </span>
          </div>

          {(overlayEnabled || sceneEnabled) && (
            <div className="flex items-center justify-between border-t border-line pt-2">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={pilotModelEnabled}
                  onChange={(event) => setPilotModelEnabled(event.target.checked)}
                />
                Use pilot model (experimental: adds box + pallet)
              </label>
              {pilotModelEnabled && (
                <span className="flex items-center gap-2 text-[11px] text-neutral-500">
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

          {pilotModelEnabled && (
            <p className="border-t border-line pt-2 text-xs leading-relaxed text-neutral-500">
              Pilot fine-tune trained on 52 hand-annotated real frames — person detection is
              strong (unchanged from the production model), box detection is real but weak,
              and pallet detection did not learn reliably (too few training instances). See{' '}
              <code className="text-[11px]">training/README.md</code> for the measured
              per-class results before treating this as more than a pilot.
            </p>
          )}

          <div className="flex items-center justify-between border-t border-line pt-2">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={sceneEnabled}
                disabled={!selectedVideo}
                onChange={(event) => setSceneEnabled(event.target.checked)}
              />
              Scene graph (spatial relationships)
            </label>
            <span className="text-xs text-neutral-500">
              {scene.error
                ? scene.error
                : sceneEnabled && scene.loading
                  ? 'Computing scene graph…'
                  : sceneEnabled && scene.data
                    ? `${scene.data.nodes.length} node${scene.data.nodes.length === 1 ? '' : 's'}, ${scene.data.edges.length} relationship${scene.data.edges.length === 1 ? '' : 's'}`
                    : ''}
            </span>
          </div>

          {sceneEnabled && (
            <p className="border-t border-line pt-2 text-xs leading-relaxed text-neutral-500">
              <svg width="20" height="10" className="mr-1 inline-block align-middle">
                <line x1="0" y1="5" x2="20" y2="5" stroke="#18181b" strokeWidth="2.5" />
              </svg>
              support (image-space hypothesis, not verified 3D contact)
              <svg width="20" height="10" className="mx-1 inline-block align-middle">
                <line x1="0" y1="5" x2="20" y2="5" stroke="#52525b" strokeWidth="2" />
              </svg>
              contact
              <svg width="20" height="10" className="mx-1 inline-block align-middle">
                <line x1="0" y1="5" x2="20" y2="5" stroke="#a1a1aa" strokeWidth="2" strokeDasharray="4 3" />
              </svg>
              proximity — geometric observations only, not risk or behaviour claims. See
              docs/WORLD_MODEL.md.
            </p>
          )}

          <div className="flex items-center justify-between border-t border-line pt-2">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={findingsEnabled}
                disabled={!selectedVideo}
                onChange={(event) => setFindingsEnabled(event.target.checked)}
              />
              Risk findings (behaviour / structural / conformance / environmental)
            </label>
            <span className="text-xs text-neutral-500">
              {findings.error
                ? findings.error
                : findingsEnabled && findings.loading
                  ? 'Evaluating…'
                  : findingsEnabled && findings.data
                    ? `${findings.data.length} finding${findings.data.length === 1 ? '' : 's'} at this frame`
                    : ''}
            </span>
          </div>

          {findingsEnabled && (
            <p className="border-t border-line pt-2 text-xs leading-relaxed text-neutral-500">
              Every finding is evidence-graded (SUPPORTED / PROBABLE / INSUFFICIENT EVIDENCE /
              UNSUPPORTED) — a low-evidence finding is never shown as a confirmed hazard. See{' '}
              <code className="text-[11px]">docs/RISK_LENSES.md</code>.
            </p>
          )}
        </div>

        {findingsEnabled && (
          <div className="mt-4 border border-line bg-white p-4">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              Findings at this frame
            </h2>
            <FindingsPanel findings={findings.data} loading={findings.loading} error={findings.error} />
          </div>
        )}

        <div className="mt-4 border border-line bg-white p-4">
          <MetadataPanel video={selectedVideo} />
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
