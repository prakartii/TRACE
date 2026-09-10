import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes,
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Eye,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Camera,
  Layers,
  Sparkles,
  Info,
} from 'lucide-react'
import { getScenes, listVideos, listZones, listManifests, streamUrl } from '../api/videos.js'
import { getVideoScenarioInfo } from '../lib/scenarios.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import FaceRedactionOverlay from '../components/video/FaceRedactionOverlay.jsx'

// High-contrast industrial palette for 2D Warehouse Blueprint
const PALETTE = {
  box: {
    fill: '#b45309',
    stroke: '#fbbf24',
    text: '#fffbeb',
    label: 'Carton',
  },
  pallet: {
    fill: '#1e3a8a',
    stroke: '#60a5fa',
    text: '#eff6ff',
    label: 'Pallet Base',
  },
  person: {
    fill: '#065f46',
    stroke: '#34d399',
    text: '#ecfdf5',
    label: 'Worker',
  },
  trolley: {
    fill: '#475569',
    stroke: '#94a3b8',
    text: '#f8fafc',
    label: 'Cart',
  },
}

function fmt(sec) {
  if (typeof sec !== 'number' || isNaN(sec)) return '00:00.0'
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1)
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`
}

export default function StructuralView() {
  const { navigateTo } = useLiveViewContext()
  const [videos, setVideos] = useState([])
  const [zones, setZones] = useState([])
  const [manifests, setManifests] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [scenes, setScenes] = useState([])
  const [loadingScenes, setLoadingScenes] = useState(false)
  const [hoveredNode, setHoveredNode] = useState(null)
  const [splitView, setSplitView] = useState(true)

  const videoRef = useRef(null)
  const videoContainerRef = useRef(null)
  const scenesCacheRef = useRef({})
  const [videoBoxSize, setVideoBoxSize] = useState({ width: 640, height: 360 })

  // Measure video container for overlays
  useEffect(() => {
    if (!videoContainerRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setVideoBoxSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })
    ro.observe(videoContainerRef.current)
    return () => ro.disconnect()
  }, [splitView])

  // Load videos, hazard zones, and operational manifests on mount
  useEffect(() => {
    listVideos()
      .then((list) => {
        setVideos(list)
        setSelectedId((cur) => cur ?? list[0]?.id ?? null)
      })
      .catch(() => {})

    listZones()
      .then(setZones)
      .catch(() => setZones([]))

    listManifests()
      .then(setManifests)
      .catch(() => setManifests([]))
  }, [])

  const selectedVideo = videos.find((v) => v.id === selectedId) ?? null
  const scenarioInfo = selectedVideo
    ? getVideoScenarioInfo(selectedVideo.id || selectedVideo.filename)
    : null

  // Fetch all scene snapshots for the selected video across the entire timeline
  useEffect(() => {
    if (!selectedId) return
    let cancelled = false

    // Instant zero-buffering retrieval from client cache
    if (scenesCacheRef.current[selectedId]) {
      setScenes(scenesCacheRef.current[selectedId])
      setLoadingScenes(false)
      return
    }

    setLoadingScenes(true)

    getScenes(selectedId, 'pilot')
      .then((data) => {
        if (!cancelled) {
          const list = data || []
          scenesCacheRef.current[selectedId] = list
          setScenes(list)
        }
      })
      .catch(() => {
        if (!cancelled) setScenes([])
      })
      .finally(() => {
        if (!cancelled) setLoadingScenes(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedId])

  // Video switch: reset playhead
  const handleSelectVideo = (newId) => {
    setSelectedId(newId)
    setCurrentTime(0)
    setIsPlaying(false)
    if (videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.pause()
    }
  }

  // Continuous 60 FPS update loop while playing for buttery smooth synchronization
  useEffect(() => {
    if (!isPlaying) return
    let frameId
    const updateLoop = () => {
      if (videoRef.current && !videoRef.current.paused) {
        setCurrentTime(videoRef.current.currentTime)
      }
      frameId = requestAnimationFrame(updateLoop)
    }
    frameId = requestAnimationFrame(updateLoop)
    return () => cancelAnimationFrame(frameId)
  }, [isPlaying])

  // Play / Pause toggle controls
  const togglePlay = () => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {})
      setIsPlaying(true)
    } else {
      videoRef.current.pause()
      setIsPlaying(false)
    }
  }

  // Scrubbing & stepping
  const maxDuration = Math.max(duration || selectedVideo?.metadata?.duration || 10, 0.1)

  const handleSeek = (timeSec) => {
    const clamped = Math.max(0, Math.min(maxDuration, timeSec))
    setCurrentTime(clamped)
    if (videoRef.current) {
      videoRef.current.currentTime = clamped
    }
  }

  const handleStep = (delta) => {
    handleSeek(currentTime + delta)
  }

  // Frame-by-frame linear interpolation: glides entities smoothly across the 2D floor at 60 FPS
  const activeSnapshot = useMemo(() => {
    if (!scenes || scenes.length === 0) return null
    if (scenes.length === 1) return scenes[0]

    // Find the surrounding scene snapshots
    let before = scenes[0]
    let after = scenes[scenes.length - 1]

    for (let i = 0; i < scenes.length; i++) {
      if (scenes[i].timestamp <= currentTime) {
        before = scenes[i]
      }
      if (scenes[i].timestamp >= currentTime) {
        after = scenes[i]
        break
      }
    }

    // Continuity protection: If either frame has zero detections (e.g. motion blur), bridge it
    if (!before.nodes?.length && after.nodes?.length) before = after
    if (!after.nodes?.length && before.nodes?.length) after = before
    if (!before.nodes?.length && !after.nodes?.length) {
      const nonEmpty = scenes.filter((s) => s.nodes?.length > 0)
      if (nonEmpty.length > 0) {
        before = nonEmpty.reduce((closest, curr) =>
          Math.abs(curr.timestamp - currentTime) < Math.abs(closest.timestamp - currentTime)
            ? curr
            : closest
        )
        after = before
      }
    }

    if (before === after) return before

    const delta = after.timestamp - before.timestamp
    if (delta <= 0.001) return before

    const alpha = Math.max(0, Math.min(1, (currentTime - before.timestamp) / delta))

    // Smoothly interpolate positions and footprints of matching nodes
    const afterNodesMap = new Map((after.nodes || []).map((n) => [n.entity_id, n]))
    const matchedAfterIds = new Set()

    const interpolatedNodes = (before.nodes || []).map((bNode) => {
      let aNode = afterNodesMap.get(bNode.entity_id)

      // Fallback: If track ID shifted during motion, match nearest candidate of same class
      if (!aNode && after.nodes?.length) {
        const bPos = bNode.position || [0.5, 0.5]
        let bestCandidate = null
        let bestDist = 0.28 // up to 28% screen distance
        for (const cand of after.nodes) {
          if (cand.entity_class === bNode.entity_class && !matchedAfterIds.has(cand.entity_id)) {
            const cPos = cand.position || [0.5, 0.5]
            const dist = Math.hypot(cPos[0] - bPos[0], cPos[1] - bPos[1])
            if (dist < bestDist) {
              bestDist = dist
              bestCandidate = cand
            }
          }
        }
        if (bestCandidate) {
          aNode = bestCandidate
        }
      }

      if (aNode) {
        matchedAfterIds.add(aNode.entity_id)
        const bPos = bNode.position || [0.5, 0.5]
        const aPos = aNode.position || bPos
        const pos = [
          bPos[0] + (aPos[0] - bPos[0]) * alpha,
          bPos[1] + (aPos[1] - bPos[1]) * alpha,
        ]

        let fp = bNode.footprint
        if (bNode.footprint && aNode.footprint) {
          fp = {
            x1: bNode.footprint.x1 + (aNode.footprint.x1 - bNode.footprint.x1) * alpha,
            y1: bNode.footprint.y1 + (aNode.footprint.y1 - bNode.footprint.y1) * alpha,
            x2: bNode.footprint.x2 + (aNode.footprint.x2 - bNode.footprint.x2) * alpha,
            y2: bNode.footprint.y2 + (aNode.footprint.y2 - bNode.footprint.y2) * alpha,
          }
        }

        return {
          ...bNode,
          position: pos,
          footprint: fp,
        }
      }

      return bNode
    })

    // Include any nodes that only appeared in `after`
    for (const aNode of after.nodes || []) {
      if (!matchedAfterIds.has(aNode.entity_id) && !interpolatedNodes.some((n) => n.entity_id === aNode.entity_id)) {
        interpolatedNodes.push(aNode)
      }
    }

    return {
      ...before,
      timestamp: currentTime,
      nodes: interpolatedNodes,
      edges: before.edges?.length ? before.edges : after.edges,
    }
  }, [scenes, currentTime])

  // Resolve manifest & filter hazard zones strictly for the active bay
  const activeManifest = useMemo(() => {
    if (!selectedVideo || !manifests.length) return null
    return manifests.find(
      (m) => m.source_id === selectedId || m.source_filename === selectedVideo.filename
    )
  }, [manifests, selectedId, selectedVideo])

  const activeZones = useMemo(() => {
    if (!activeManifest) {
      // Fallback: match by filename keywords
      const fn = (selectedVideo?.filename || '').toLowerCase()
      if (fn.includes('wet')) return zones.filter((z) => z.zone_id.includes('wet_floor'))
      if (fn.includes('dragging') || fn.includes('cupboard') || fn.includes('kd packets')) {
        return zones.filter((z) => z.zone_id.includes('dock_09'))
      }
      if (fn.includes('stepping') || fn.includes('dock 10')) {
        return zones.filter((z) => z.zone_id.includes('dock_10'))
      }
      return []
    }
    const allowed = new Set(activeManifest.zone_ids || [])
    return zones.filter((z) => allowed.has(z.zone_id))
  }, [zones, activeManifest, selectedVideo])

  // Extract person entities for face redaction on video
  const personEntities = useMemo(() => {
    if (!activeSnapshot?.nodes) return []
    const sw = selectedVideo?.metadata?.width || 1280
    const sh = selectedVideo?.metadata?.height || 720
    return activeSnapshot.nodes
      .filter((n) => n.entity_class === 'person' && n.footprint)
      .map((n) => ({
        id: n.entity_id,
        entity_class: 'person',
        bbox: {
          x1: n.footprint.x1 * sw,
          y1: n.footprint.y1 * sh,
          x2: n.footprint.x2 * sw,
          y2: n.footprint.y2 * sh,
        },
      }))
  }, [activeSnapshot, selectedVideo])

  // Dynamic safety status in simple English based on current frame findings
  const safetyStatus = useMemo(() => {
    if (!selectedVideo) return { level: 'Safe', title: 'Normal Operation', action: 'All cargo stable.' }
    const scen = (scenarioInfo?.scenarioKey || '').toLowerCase()

    // Check if any carton in current frame has overhang
    const edges = activeSnapshot?.edges || []
    const hasActiveOverhang = edges.some(
      (e) => e.edge_type === 'support' && (e.evidence?.horizontal_overlap_ratio ?? 1) < 0.7
    )

    if (hasActiveOverhang || scen.includes('overhang') || scen.includes('heavy_on_light')) {
      return {
        level: 'Warning',
        bg: 'border-warn/50 bg-warn/10 text-warn',
        title: 'Box Overhanging Pallet Edge',
        action: 'A box is sticking out over the edge of the pallet by more than 30%. Push it inward.',
      }
    }
    if (scen.includes('dock') || scen.includes('cupboard')) {
      return {
        level: 'Alert',
        bg: 'border-danger/50 bg-danger/10 text-danger',
        title: 'Dock Edge Buffer Warning',
        action: 'Maintain at least 1.5m clearance from the loading dock ledge.',
      }
    }
    if (scen.includes('wet')) {
      return {
        level: 'Hazard',
        bg: 'border-sky-500/50 bg-sky-500/10 text-sky-600',
        title: 'Wet Floor Spill Area',
        action: 'Floor is wet. Move slowly and clean up spill before rolling heavy loads.',
      }
    }
    if (scen.includes('step')) {
      return {
        level: 'Warning',
        bg: 'border-danger/50 bg-danger/10 text-danger',
        title: 'Worker Standing on Inventory',
        action: 'Use a rolling stepladder. Never stand directly on cargo boxes.',
      }
    }
    if (scen.includes('drop') || scen.includes('throw')) {
      return {
        level: 'Warning',
        bg: 'border-warn/50 bg-warn/10 text-warn',
        title: 'Package Handling Caution',
        action: 'Handle packages gently. Do not drop or throw cartons.',
      }
    }

    return {
      level: 'Safe',
      bg: 'border-ok/40 bg-ok/10 text-ok',
      title: 'Stable Placement',
      action: 'All boxes and pallets are safely positioned.',
    }
  }, [selectedVideo, scenarioInfo, activeSnapshot])

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink text-paper">
              <Boxes size={15} />
            </span>
            <h1 className="text-xl font-bold text-ink">2D Structural Digital Twin</h1>
            <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
              {loadingScenes ? 'Loading Timeline…' : 'Frame Sync Active'}
            </span>
          </div>
          <p className="mt-1 text-small text-ink-soft">
            Top-down warehouse floor layout synchronized with live security cameras frame-by-frame.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigateTo('Incident Replay', { videoId: selectedId, timestamp: currentTime })}
          className="inline-flex items-center gap-1.5 border border-ink bg-ink px-3.5 py-1.5 text-small font-medium text-paper transition-colors hover:bg-ink-soft"
        >
          <Eye size={13} />
          Open Full Replay →
        </button>
      </section>

      {/* Safety Notice Banner */}
      <section className={`flex flex-wrap items-center justify-between gap-3 border p-3 ${safetyStatus.bg}`}>
        <div className="flex items-center gap-2.5">
          <ShieldAlert size={18} className="shrink-0" />
          <div>
            <span className="font-semibold uppercase tracking-wider text-[11px]">
              {safetyStatus.level}: {safetyStatus.title}
            </span>
            <p className="text-small text-ink font-medium mt-0.5">{safetyStatus.action}</p>
          </div>
        </div>
        <span className="text-caption font-semibold uppercase tracking-wider">
          {scenarioInfo?.cameraName || activeManifest?.bay_name || 'Active Camera'}
        </span>
      </section>

      {/* Controls Bar: Camera Selector, View Mode, Playback */}
      <section className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface p-3 shadow-xs">
        {/* Camera Bay Selector */}
        <div className="flex items-center gap-2">
          <span className="text-caption font-semibold text-ink-soft flex items-center gap-1">
            <Camera size={13} />
            Camera:
          </span>
          <select
            value={selectedId ?? ''}
            onChange={(e) => handleSelectVideo(e.target.value)}
            className="border border-line bg-paper px-2.5 py-1 text-small font-medium text-ink focus:border-ink"
          >
            {videos.map((v) => {
              const vi = getVideoScenarioInfo(v.id || v.filename)
              return (
                <option key={v.id} value={v.id}>
                  {vi.cameraName} ({vi.tag})
                </option>
              )
            })}
          </select>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSplitView(true)}
            className={`px-2.5 py-1 text-caption font-medium transition-colors ${
              splitView ? 'bg-ink text-paper' : 'border border-line bg-paper text-ink-soft hover:text-ink'
            }`}
          >
            Split (2D Map + Camera)
          </button>
          <button
            type="button"
            onClick={() => setSplitView(false)}
            className={`px-2.5 py-1 text-caption font-medium transition-colors ${
              !splitView ? 'bg-ink text-paper' : 'border border-line bg-paper text-ink-soft hover:text-ink'
            }`}
          >
            2D Map Only
          </button>
        </div>

        {/* Real Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-7 w-7 items-center justify-center border border-ink bg-ink text-paper hover:bg-ink-soft cursor-pointer transition-colors"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => handleStep(-0.5)}
            className="flex h-7 w-7 items-center justify-center border border-line bg-paper text-ink hover:border-ink cursor-pointer"
            title="Step Back -0.5s"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            onClick={() => handleStep(0.5)}
            className="flex h-7 w-7 items-center justify-center border border-line bg-paper text-ink hover:border-ink cursor-pointer"
            title="Step Forward +0.5s"
          >
            <ChevronRight size={13} />
          </button>
          <button
            type="button"
            onClick={() => handleSeek(0)}
            className="flex h-7 w-7 items-center justify-center border border-line bg-paper text-ink hover:border-ink cursor-pointer"
            title="Reset to start"
          >
            <RotateCcw size={12} />
          </button>

          <span className="font-mono text-caption font-semibold text-ink px-1">
            {fmt(currentTime)} <span className="text-ink-faint">/ {fmt(duration || selectedVideo?.metadata?.duration || 0)}</span>
          </span>

          <input
            type="range"
            min={0}
            max={Math.max(duration || selectedVideo?.metadata?.duration || 1, 0.1)}
            step={0.1}
            value={currentTime}
            onChange={(e) => handleSeek(parseFloat(e.target.value))}
            className="w-28 sm:w-44 accent-ink cursor-pointer ml-1"
          />
        </div>
      </section>

      {/* Main Workstation Screen */}
      <section className="border border-line bg-surface p-4 shadow-xs">
        <div className={`grid grid-cols-1 ${splitView ? 'lg:grid-cols-2' : ''} gap-4 items-start`}>
          {/* Left: 2D Blueprint Map */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-caption font-semibold uppercase tracking-wider text-ink-soft">
              <span className="flex items-center gap-1.5">
                <Layers size={13} />
                Top-Down Floor Blueprint
              </span>
              <span className="text-ink font-mono text-[11px] font-medium">
                {hoveredNode || (
                  <span>
                    <strong className="text-amber-600 font-bold">{activeSnapshot?.nodes?.filter((n) => n.entity_class === 'box').length || 0}</strong> cartons/packets ·{' '}
                    <strong className="text-blue-600 font-bold">{activeSnapshot?.nodes?.filter((n) => n.entity_class === 'pallet').length || 0}</strong> pallets ·{' '}
                    <strong className="text-emerald-600 font-bold">{activeSnapshot?.nodes?.filter((n) => n.entity_class === 'person').length || 0}</strong> personnel
                  </span>
                )}
              </span>
            </div>

            <div className="relative aspect-[16/9] w-full border-2 border-line bg-[#090e17] overflow-hidden select-none rounded-xs shadow-inner">
              {loadingScenes && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs text-white">
                  <span className="h-5 w-5 animate-spin border-2 border-white border-t-transparent rounded-full mb-1.5" />
                  <span className="text-[11px] font-mono tracking-wider">Syncing High-Precision 2D Digital Twin…</span>
                </div>
              )}
              <BlueprintMap
                snapshot={activeSnapshot}
                zones={activeZones}
                onHover={setHoveredNode}
              />
            </div>

            {/* High Contrast Legend */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-caption text-ink-soft">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 font-medium text-amber-500">
                  <span className="h-3 w-3 bg-amber-500 rounded-xs border border-amber-300" />
                  Carton / Box
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium text-blue-400">
                  <span className="h-3 w-3 bg-blue-600 rounded-xs border border-blue-400" />
                  Pallet Deck
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                  <span className="h-3 w-3 bg-emerald-500 rounded-full border border-emerald-300" />
                  Worker
                </span>
              </div>
              <div className="flex items-center gap-3">
                {activeZones.some((z) => z.zone_type === 'dock_edge') && (
                  <span className="inline-flex items-center gap-1.5 text-rose-400 font-medium">
                    <span className="h-3 w-3 border border-rose-500 bg-rose-500/40 rounded-xs" />
                    Dock Edge Buffer
                  </span>
                )}
                {activeZones.some((z) => z.zone_type === 'wet_floor') && (
                  <span className="inline-flex items-center gap-1.5 text-sky-400 font-medium">
                    <span className="h-3 w-3 border border-sky-400 bg-sky-500/40 rounded-xs" />
                    Wet Floor Zone
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Synchronized Live Camera Video */}
          {splitView && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-caption font-semibold uppercase tracking-wider text-ink-soft">
                <span className="flex items-center gap-1.5">
                  <Camera size={13} />
                  Synchronized Camera CCTV
                </span>
                <span className="font-mono text-[11px] text-ink-faint">{fmt(currentTime)}</span>
              </div>

              <div
                ref={videoContainerRef}
                onClick={togglePlay}
                className="relative aspect-[16/9] w-full border-2 border-line bg-black overflow-hidden flex items-center justify-center rounded-xs cursor-pointer group select-none"
              >
                {selectedId && (
                  <video
                    ref={videoRef}
                    src={streamUrl(selectedId)}
                    playsInline
                    muted
                    preload="auto"
                    className="h-full w-full object-contain"
                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                  />
                )}

                {/* Face Privacy Redaction Overlay */}
                <FaceRedactionOverlay
                  entities={personEntities}
                  sourceWidth={selectedVideo?.metadata?.width || 1280}
                  sourceHeight={selectedVideo?.metadata?.height || 720}
                  displayWidth={videoBoxSize.width}
                  displayHeight={videoBoxSize.height}
                  enabled={true}
                />

                <div className="absolute top-2 left-2 border border-ok/40 bg-black/70 px-2 py-0.5 text-[10px] font-mono text-paper font-semibold uppercase tracking-wider flex items-center gap-1.5 pointer-events-none">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  {scenarioInfo?.cameraName || 'CCTV'} · SYNCED
                </div>

                {/* Center Play Overlay when Paused */}
                {!isPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none transition-opacity">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-paper/95 text-ink shadow-lg group-hover:scale-110 transition-transform">
                      <Play size={22} className="ml-1 fill-ink" />
                    </div>
                  </div>
                )}
              </div>

              <p className="flex items-center gap-1.5 text-caption text-ink-faint pt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                Synced to the playback controls above — the 2D map and this camera always show the same instant.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

// Clean, high-contrast 2D Blueprint SVG component
function BlueprintMap({ snapshot, zones, onHover }) {
  const nodes = snapshot?.nodes ?? []
  const edges = snapshot?.edges ?? []
  const nodeById = useMemo(() => Object.fromEntries(nodes.map((n) => [n.entity_id, n])), [nodes])

  // Sort nodes: pallets on floor deck, stacked cartons ordered with depth, workers on top
  const sortedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => {
      const classRank = { pallet: 0, box: 1, person: 2 }
      const diff = (classRank[a.entity_class] ?? 1) - (classRank[b.entity_class] ?? 1)
      if (diff !== 0) return diff
      const yA = a.footprint?.y2 ?? (a.position ? a.position[1] : 0)
      const yB = b.footprint?.y2 ?? (b.position ? b.position[1] : 0)
      return yA - yB
    })
  }, [nodes])

  return (
    <svg
      viewBox="0 0 160 90"
      className="w-full h-full cursor-crosshair"
      role="img"
      aria-label="2D Warehouse Floor Map"
    >
      <defs>
        {/* Subtle Background Blueprint Grid */}
        <pattern id="twin-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#1e293b" strokeWidth="0.3" />
        </pattern>

        {/* Dock Hazard Stripes */}
        <pattern
          id="twin-dock-hatch"
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="2" height="4" fill="#f43f5e" fillOpacity="0.45" />
          <rect x="2" width="2" height="4" fill="#881337" fillOpacity="0.45" />
        </pattern>

        {/* Wet Floor Blue Pattern */}
        <pattern
          id="twin-wet-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-45)"
        >
          <rect width="3" height="6" fill="#38bdf8" fillOpacity="0.4" />
          <rect x="3" width="3" height="6" fill="#0284c7" fillOpacity="0.25" />
        </pattern>

        {/* Support Vector Arrow */}
        <marker
          id="support-down-arrow"
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto"
        >
          <path d="M 0 2 L 8 5 L 0 8 z" fill="#34d399" />
        </marker>
        <marker
          id="support-down-arrow-warn"
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto"
        >
          <path d="M 0 2 L 8 5 L 0 8 z" fill="#f43f5e" />
        </marker>
      </defs>

      {/* Blueprint Floor Deck */}
      <rect width="160" height="90" fill="#090e17" />
      <rect width="160" height="90" fill="url(#twin-grid)" />

      {/* Coordinate Crosshairs */}
      <g stroke="#334155" strokeWidth="0.3">
        <line x1="4" y1="4" x2="10" y2="4" />
        <line x1="7" y1="1" x2="7" y2="7" />
        <line x1="150" y1="4" x2="156" y2="4" />
        <line x1="153" y1="1" x2="153" y2="7" />
        <line x1="4" y1="86" x2="10" y2="86" />
        <line x1="7" y1="83" x2="7" y2="89" />
        <line x1="150" y1="86" x2="156" y2="86" />
        <line x1="153" y1="83" x2="153" y2="89" />
      </g>

      {/* Walkway Lane Designation */}
      <line
        x1="10"
        y1="82"
        x2="150"
        y2="82"
        stroke="#ca8a04"
        strokeWidth="0.4"
        strokeDasharray="4 2"
      />
      <text x="12" y="80.5" fontSize="2.2" fill="#eab308" fontWeight="600" letterSpacing="0.5">
        WALKWAY PERIMETER AISLE
      </text>

      {/* Hazard Zones (Filtered strictly to active bay) */}
      {zones.map((z) => {
        const isDock = z.zone_type === 'dock_edge'
        const pts = z.polygon
          .map(([x, y]) => `${(x * 160).toFixed(1)},${(y * 90).toFixed(1)}`)
          .join(' ')
        const [firstX, firstY] = z.polygon[0] || [0, 0]
        return (
          <g key={z.zone_id}>
            <polygon
              points={pts}
              fill={isDock ? 'url(#twin-dock-hatch)' : 'url(#twin-wet-hatch)'}
              stroke={isDock ? '#f43f5e' : '#38bdf8'}
              strokeWidth="0.8"
            />
            <text
              x={firstX * 160 + 2}
              y={firstY * 90 + 4}
              fontSize="2.6"
              fontWeight="800"
              fill={isDock ? '#fb7185' : '#7dd3fc'}
            >
              {isDock ? '⚠️ DOCK EDGE (1.5M BUFFER)' : '💧 WET FLOOR SPILL'}
            </text>
          </g>
        )
      })}

      {/* Support Hierarchy Relationships (Connecting Edges) */}
      {edges.map((edge, i) => {
        const a = nodeById[edge.source_id]
        const b = nodeById[edge.target_id]
        if (!a || !b) return null

        const x1 = a.position[0] * 160
        const y1 = a.position[1] * 90
        const x2 = b.position[0] * 160
        const y2 = b.position[1] * 90

        if (edge.edge_type === 'support') {
          const overlap = Math.round((edge.evidence?.horizontal_overlap_ratio ?? 0.85) * 100)
          const isWarning = overlap < 70
          return (
            <g key={`edge-${i}`}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isWarning ? '#f43f5e' : '#34d399'}
                strokeWidth={isWarning ? '0.9' : '0.6'}
                strokeDasharray={isWarning ? '2 1' : 'none'}
                markerEnd={isWarning ? 'url(#support-down-arrow-warn)' : 'url(#support-down-arrow)'}
              />
            </g>
          )
        }
        return null
      })}

      {/* Entity Nodes (Pallets, Boxes, Personnel) */}
      {sortedNodes.map((node) => {
        const palette = PALETTE[node.entity_class] || PALETTE.box
        const [cx, cy] = [node.position[0] * 160, node.position[1] * 90]

        const fp = node.footprint
        const fx = fp ? fp.x1 * 160 : cx - 6
        const fy = fp ? fp.y1 * 90 : cy - 5
        const fw = fp ? Math.max(6, (fp.x2 - fp.x1) * 160) : 14
        const fh = fp ? Math.max(5, (fp.y2 - fp.y1) * 90) : 10

        // Support edge / overhang check
        const supportEdge = edges.find(
          (e) => e.target_id === node.entity_id && e.edge_type === 'support'
        )
        const hasOverhang =
          supportEdge && (supportEdge.evidence?.horizontal_overlap_ratio ?? 1) < 0.7

        return (
          <g
            key={node.entity_id}
            onMouseEnter={() =>
              onHover(
                `${palette.label} (${hasOverhang ? 'WARNING: overhanging pallet edge' : 'safely positioned'})`
              )
            }
            onMouseLeave={() => onHover(null)}
            className="cursor-pointer transition-transform duration-100 ease-out"
          >
            {/* Box / Carton Node */}
            {node.entity_class === 'box' && (
              <g>
                {hasOverhang && (
                  <rect
                    x={fx - 1.5}
                    y={fy - 1.5}
                    width={fw + 3}
                    height={fh + 3}
                    rx="1"
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth="0.9"
                    strokeDasharray="2 1"
                  />
                )}
                <rect
                  x={fx}
                  y={fy}
                  width={fw}
                  height={fh}
                  rx="0.8"
                  fill={hasOverhang ? '#881337' : palette.fill}
                  stroke={hasOverhang ? '#f43f5e' : palette.stroke}
                  strokeWidth="0.8"
                />
                {/* Center tape divider line */}
                <line
                  x1={fx + fw / 2}
                  y1={fy}
                  x2={fx + fw / 2}
                  y2={fy + fh}
                  stroke={hasOverhang ? '#fda4af' : '#fef08a'}
                  strokeWidth="0.4"
                  strokeDasharray="1.5 1"
                />
                <text
                  x={cx}
                  y={cy + 1}
                  fontSize="2.4"
                  fontWeight="800"
                  fill={hasOverhang ? '#ffe4e6' : palette.text}
                  textAnchor="middle"
                >
                  {hasOverhang ? 'OVERHANG' : 'CARTON'}
                </text>
              </g>
            )}

            {/* Pallet Node */}
            {node.entity_class === 'pallet' && (
              <g>
                <rect
                  x={fx}
                  y={fy}
                  width={fw}
                  height={fh}
                  rx="0.6"
                  fill="#1e3a8a"
                  stroke="#60a5fa"
                  strokeWidth="0.9"
                />
                {/* Pallet wood slat lines */}
                <line
                  x1={fx}
                  y1={fy + fh * 0.33}
                  x2={fx + fw}
                  y2={fy + fh * 0.33}
                  stroke="#93c5fd"
                  strokeWidth="0.4"
                />
                <line
                  x1={fx}
                  y1={fy + fh * 0.66}
                  x2={fx + fw}
                  y2={fy + fh * 0.66}
                  stroke="#93c5fd"
                  strokeWidth="0.4"
                />
                <text
                  x={cx}
                  y={cy + 1}
                  fontSize="2.4"
                  fontWeight="800"
                  fill="#eff6ff"
                  textAnchor="middle"
                >
                  PALLET DECK
                </text>
              </g>
            )}

            {/* Worker Node */}
            {node.entity_class === 'person' && (
              <g>
                {/* Surrounding perimeter ripple */}
                <circle
                  cx={cx}
                  cy={cy}
                  r="7"
                  fill="rgba(52, 211, 153, 0.15)"
                  stroke="#34d399"
                  strokeWidth="0.4"
                  strokeDasharray="2 1.5"
                />
                {/* High-visibility center badge */}
                <circle
                  cx={cx}
                  cy={cy}
                  r="3.8"
                  fill="#065f46"
                  stroke="#34d399"
                  strokeWidth="0.9"
                />
                <text
                  x={cx}
                  y={cy + 1}
                  fontSize="2.2"
                  fontWeight="800"
                  fill="#ecfdf5"
                  textAnchor="middle"
                >
                  WORKER
                </text>
              </g>
            )}

            {/* Generic other entity */}
            {node.entity_class !== 'box' &&
              node.entity_class !== 'pallet' &&
              node.entity_class !== 'person' && (
                <g>
                  <rect
                    x={fx}
                    y={fy}
                    width={fw}
                    height={fh}
                    rx="0.6"
                    fill={palette.fill}
                    stroke={palette.stroke}
                    strokeWidth="0.7"
                  />
                  <text
                    x={cx}
                    y={cy + 1}
                    fontSize="2.2"
                    fontWeight="700"
                    fill={palette.text}
                    textAnchor="middle"
                  >
                    {palette.label.toUpperCase()}
                  </text>
                </g>
              )}
          </g>
        )
      })}
    </svg>
  )
}
