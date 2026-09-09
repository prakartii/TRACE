import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  Boxes,
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Eye,
  Layers,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Maximize2,
  Columns,
  Sparkles,
  Activity,
  Compass,
  ExternalLink,
  Camera,
  Scale,
  Crosshair,
  Info,
  Sliders,
  ShieldCheck,
} from 'lucide-react'
import { getScene, listVideos, listZones, frameUrl, getFindings } from '../api/videos.js'
import { listEvents } from '../api/events.js'
import { getVideoScenarioInfo, SCENARIO_REGISTRY } from '../lib/scenarios.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'

// Industrial Blueprint Color Palette & Edge Styles
const NODE_PALETTE = {
  box: {
    primary: '#d97706',
    border: '#f59e0b',
    fill: '#451a03',
    tape: '#b45309',
    label: 'Carton',
  },
  pallet: {
    primary: '#15803d',
    border: '#22c55e',
    fill: '#052e16',
    slat: '#166534',
    label: 'Timber Pallet',
  },
  person: {
    primary: '#06b6d4',
    border: '#22d3ee',
    fill: '#083344',
    halo: 'rgba(6, 182, 212, 0.2)',
    label: 'Personnel',
  },
  trolley: {
    primary: '#0284c7',
    border: '#38bdf8',
    fill: '#082f49',
    label: 'Cart / Trolley',
  },
  vehicle_bed: {
    primary: '#64748b',
    border: '#94a3b8',
    fill: '#0f172a',
    label: 'Vehicle Bed',
  },
}

const DEFAULT_PALETTE = {
  primary: '#94a3b8',
  border: '#cbd5e1',
  fill: '#1e293b',
  label: 'Unknown Entity',
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
  const [events, setEvents] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [timestamp, setTimestamp] = useState(0)
  const [model, setModel] = useState('pilot')
  const [snapshot, setSnapshot] = useState(null)
  const [findings, setFindings] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Interactive View States
  const [viewMode, setViewMode] = useState('split') // 'cad' | 'split' | 'pip'
  const [selectedEntityId, setSelectedEntityId] = useState(null)
  const [hoveredEntityId, setHoveredEntityId] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const playTimerRef = useRef(null)

  // Initial Data Fetch
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
  }, [])

  // Fetch events for current video to mark on timeline
  useEffect(() => {
    if (!selectedId) return
    listEvents({ videoId: selectedId, limit: 100 })
      .then((res) => {
        const evs = Array.isArray(res) ? res : res.events || []
        setEvents(evs)
      })
      .catch(() => setEvents([]))
  }, [selectedId])

  const selectedVideo = videos.find((v) => v.id === selectedId) ?? null
  const duration = selectedVideo?.metadata?.duration ?? 0
  const scenarioInfo = selectedVideo ? getVideoScenarioInfo(selectedVideo.id || selectedVideo.filename) : null

  // Fetch Scene Snapshot & Findings on (selectedId, timestamp, model)
  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.allSettled([
      getScene(selectedId, timestamp, model),
      getFindings(selectedId, timestamp, model),
    ]).then(([sceneRes, findingsRes]) => {
      if (cancelled) return
      if (sceneRes.status === 'fulfilled') {
        setSnapshot(sceneRes.value)
        // Default select the first box or person if nothing selected
        if (!selectedEntityId && sceneRes.value?.nodes?.length > 0) {
          const defaultNode =
            sceneRes.value.nodes.find((n) => n.entity_class === 'box') ||
            sceneRes.value.nodes[0]
          setSelectedEntityId(defaultNode?.entity_id ?? null)
        }
      } else {
        setError(sceneRes.reason?.message || 'Failed to load scene graph')
        setSnapshot(null)
      }

      if (findingsRes.status === 'fulfilled') {
        setFindings(findingsRes.value || [])
      } else {
        setFindings([])
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [selectedId, timestamp, model])

  // Playback Loop
  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current) clearInterval(playTimerRef.current)
      return
    }

    const intervalMs = Math.round(500 / playbackSpeed)
    playTimerRef.current = setInterval(() => {
      setTimestamp((t) => {
        const next = Math.round((t + 0.5) * 10) / 10
        if (next > (duration || 10)) {
          return 0
        }
        return next
      })
    }, intervalMs)

    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current)
    }
  }, [isPlaying, playbackSpeed, duration])

  const nodeById = useMemo(
    () => Object.fromEntries((snapshot?.nodes ?? []).map((n) => [n.entity_id, n])),
    [snapshot]
  )

  const selectedNode = selectedEntityId ? nodeById[selectedEntityId] : null

  // Calculate Scene Physical Metrics
  const sceneMetrics = useMemo(() => {
    const nodes = snapshot?.nodes ?? []
    const edges = snapshot?.edges ?? []

    const boxes = nodes.filter((n) => n.entity_class === 'box')
    const pallets = nodes.filter((n) => n.entity_class === 'pallet')
    const people = nodes.filter((n) => n.entity_class === 'person')

    // Check support overlaps
    const supportEdges = edges.filter((e) => e.edge_type === 'support')
    let totalOverlap = 0
    let overhangCount = 0

    supportEdges.forEach((e) => {
      const ratio = e.evidence?.horizontal_overlap_ratio ?? 0.85
      totalOverlap += ratio
      if (ratio < 0.7) overhangCount++
    })

    const avgOverlap = supportEdges.length > 0 ? totalOverlap / supportEdges.length : 1.0
    // Stability score formula
    let stabilityScore = Math.round(avgOverlap * 100)
    if (overhangCount > 0) stabilityScore = Math.max(35, stabilityScore - 25 * overhangCount)
    if (findings.length > 0) stabilityScore = Math.min(stabilityScore, 58)

    return {
      boxCount: boxes.length,
      palletCount: pallets.length,
      personCount: people.length,
      stabilityScore: Math.min(100, Math.max(0, stabilityScore)),
      overhangCount,
      supportCount: supportEdges.length,
    }
  }, [snapshot, findings])

  const handleStep = (delta) => {
    setIsPlaying(false)
    setTimestamp((t) => {
      const next = Math.max(0, Math.min(duration || 10, Math.round((t + delta) * 10) / 10))
      return next
    })
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* Top Header & Context */}
      <section className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink text-paper">
              <Boxes size={15} />
            </span>
            <h1 className="font-display text-display-lg font-semibold text-ink">
              2D Structural Digital Twin
            </h1>
            <span className="border border-line bg-surface px-2 py-0.5 text-label font-mono uppercase tracking-wider text-ink-soft">
              16:9 CAD blueprint
            </span>
            <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-medium uppercase tracking-wider text-ok">
              world model active
            </span>
          </div>
          <p className="mt-1.5 max-w-3xl text-body text-ink-soft">
            Physics-grounded 2D structural twin with real-time support load-transfer mechanics,
            geometric overhang analysis, OSHA hazard clearance zoning, and live CCTV optical correlation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              navigateTo('What-If Replay', {
                videoId: selectedId,
                timestamp,
                scenario: scenarioInfo?.scenarioKey,
                entityId: selectedEntityId,
              })
            }
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-3.5 py-1.5 text-small font-medium text-ink transition-colors hover:border-ink hover:text-ink"
          >
            <Sparkles size={13} className="text-accent" />
            What-If Simulator →
          </button>
          <button
            type="button"
            onClick={() => navigateTo('Live View', { videoId: selectedId, timestamp })}
            className="inline-flex items-center gap-1.5 border border-ink bg-ink px-3.5 py-1.5 text-small font-medium text-paper transition-colors hover:bg-ink-soft"
          >
            <Eye size={13} />
            Live CCTV View →
          </button>
        </div>
      </section>

      {/* Operational Scenario Guidance Banner */}
      {scenarioInfo && (
        <section className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface p-3.5 shadow-xs">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-sm border ${
                scenarioInfo.riskBand === 'Critical'
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-warn/30 bg-warn/10 text-warn'
              }`}
            >
              <ShieldAlert size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2 text-caption">
                <span className="font-semibold uppercase tracking-wider text-ink">
                  {scenarioInfo.cameraName}
                </span>
                <span>·</span>
                <span
                  className={`border px-1.5 py-0.2 text-[10px] font-semibold uppercase tracking-wider ${
                    scenarioInfo.riskBand === 'Critical'
                      ? 'border-danger/30 bg-danger/10 text-danger'
                      : 'border-warn/30 bg-warn/10 text-warn'
                  }`}
                >
                  {scenarioInfo.riskLevel}
                </span>
                <span className="text-ink-faint">Lens: {scenarioInfo.scenarioKey}</span>
              </div>
              <div className="text-small font-semibold text-ink">{scenarioInfo.scenarioTitle}</div>
            </div>
          </div>

          <div className="max-w-md text-caption text-ink-soft bg-paper border border-line p-2">
            <span className="font-semibold text-ink">Safety Protocol: </span>
            {scenarioInfo.recommendedAction}
          </div>
        </section>
      )}

      {/* Top Controls Deck: Camera, Time, View Mode, Model */}
      <section className="grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-4">
        {/* Camera / Bay */}
        <div className="flex flex-col gap-1 bg-surface p-3">
          <span className="text-label font-medium text-ink-faint flex items-center gap-1">
            <Camera size={12} />
            inspection camera
          </span>
          <select
            value={selectedId ?? ''}
            onChange={(e) => {
              setSelectedId(e.target.value)
              setTimestamp(0)
              setIsPlaying(false)
            }}
            className="border border-line bg-paper px-2.5 py-1.5 text-small text-ink focus:border-ink font-medium"
          >
            {videos.map((v) => {
              const vi = getVideoScenarioInfo(v.id || v.filename)
              return (
                <option key={v.id} value={v.id}>
                  {vi.cameraName} ({vi.scenarioTitle.slice(0, 24)}…)
                </option>
              )
            })}
          </select>
        </div>

        {/* View Mode */}
        <div className="flex flex-col gap-1 bg-surface p-3">
          <span className="text-label font-medium text-ink-faint flex items-center gap-1">
            <Columns size={12} />
            display configuration
          </span>
          <div className="grid grid-cols-3 gap-1">
            {[
              { id: 'cad', label: 'CAD 2D' },
              { id: 'split', label: 'Split Dual' },
              { id: 'pip', label: 'PIP Inset' },
            ].map((vm) => (
              <button
                key={vm.id}
                type="button"
                onClick={() => setViewMode(vm.id)}
                className={`py-1.5 text-caption font-medium transition-colors ${
                  viewMode === vm.id
                    ? 'bg-ink text-paper'
                    : 'border border-line bg-paper text-ink-soft hover:text-ink'
                }`}
              >
                {vm.label}
              </button>
            ))}
          </div>
        </div>

        {/* Perception Model */}
        <div className="flex flex-col gap-1 bg-surface p-3">
          <span className="text-label font-medium text-ink-faint flex items-center gap-1">
            <Layers size={12} />
            perception model
          </span>
          <div className="grid grid-cols-2 gap-1">
            {[
              { id: 'pilot', label: 'Pilot (Fine-tuned)' },
              { id: 'stock', label: 'Stock (COCO)' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModel(m.id)}
                className={`py-1.5 text-caption font-medium transition-colors ${
                  model === m.id
                    ? 'bg-ink text-paper'
                    : 'border border-line bg-paper text-ink-soft hover:text-ink'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scene Stability KPI */}
        <div className="flex items-center justify-between bg-surface p-3">
          <div>
            <span className="text-label font-medium text-ink-faint flex items-center gap-1">
              <Scale size={12} />
              stability index
            </span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span
                className={`text-display font-semibold font-mono ${
                  sceneMetrics.stabilityScore < 60
                    ? 'text-danger'
                    : sceneMetrics.stabilityScore < 80
                    ? 'text-warn'
                    : 'text-ok'
                }`}
              >
                {sceneMetrics.stabilityScore}%
              </span>
              <span className="text-caption text-ink-faint">
                {sceneMetrics.stabilityScore < 60
                  ? 'UNSTABLE'
                  : sceneMetrics.stabilityScore < 80
                  ? 'MARGINAL'
                  : 'STABLE'}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-0.5 text-[11px] text-ink-soft">
            <span>{sceneMetrics.boxCount} Boxes · {sceneMetrics.palletCount} Pallets</span>
            <span>{sceneMetrics.personCount} Personnel · {sceneMetrics.supportCount} Supports</span>
          </div>
        </div>
      </section>

      {/* Playback & Timeline Transport Bar */}
      <section className="flex flex-wrap items-center justify-between gap-3 border border-line bg-paper p-3 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            className="flex h-8 w-8 items-center justify-center border border-ink bg-ink text-paper transition-colors hover:bg-ink-soft"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => handleStep(-0.5)}
            className="flex h-8 w-8 items-center justify-center border border-line bg-surface text-ink hover:border-ink"
            title="Step Back -0.5s"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => handleStep(0.5)}
            className="flex h-8 w-8 items-center justify-center border border-line bg-surface text-ink hover:border-ink"
            title="Step Forward +0.5s"
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsPlaying(false)
              setTimestamp(0)
            }}
            className="flex h-8 w-8 items-center justify-center border border-line bg-surface text-ink hover:border-ink"
            title="Reset to 00:00"
          >
            <RotateCcw size={13} />
          </button>

          <span className="font-mono text-small font-semibold text-ink px-2">
            {fmt(timestamp)} <span className="text-ink-faint">/ {fmt(duration)}</span>
          </span>
        </div>

        {/* Scrubber Timeline with Hazard Dots */}
        <div className="flex-1 max-w-xl px-2 relative flex items-center">
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.5}
            value={Math.min(timestamp, duration || 0)}
            onChange={(e) => {
              setIsPlaying(false)
              setTimestamp(parseFloat(e.target.value))
            }}
            className="w-full accent-ink cursor-pointer"
          />

          {/* Event markers on timeline */}
          {events.map((ev) => {
            if (typeof ev.timestamp !== 'number' || duration <= 0) return null
            const leftPct = (ev.timestamp / duration) * 100
            return (
              <span
                key={ev.event_id}
                style={{ left: `${leftPct}%` }}
                className="absolute top-1 h-2 w-1 bg-danger -translate-x-1/2 pointer-events-none"
                title={`Event #${ev.event_id} at ${fmt(ev.timestamp)}`}
              />
            )
          })}
        </div>

        {/* Speed Selector */}
        <div className="flex items-center gap-1 text-caption">
          <span className="text-ink-faint mr-1">speed:</span>
          {[0.5, 1, 2].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPlaybackSpeed(s)}
              className={`px-2 py-0.5 text-caption font-mono ${
                playbackSpeed === s
                  ? 'border border-ink bg-ink text-paper'
                  : 'border border-line bg-surface text-ink-soft hover:text-ink'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="border border-danger/40 bg-danger/5 p-4 text-small text-danger flex items-center gap-2">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Main CAD & Inspector Workstation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left / Center: CAD Blueprint View & Synchronized Camera Frame */}
        <div className={`${selectedEntityId ? 'lg:col-span-8' : 'lg:col-span-12'} flex flex-col gap-4`}>
          <div className="border border-line bg-surface p-4 shadow-xs">
            {/* Workstation Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <Compass size={15} className="text-ink-soft" />
                <h2 className="text-small font-semibold text-ink">
                  {scenarioInfo?.cameraName ?? 'Structural Canvas'} · Coordinate Frame: 160 × 90
                </h2>
                {snapshot && (
                  <span className="text-caption text-ink-faint font-mono">
                    [{snapshot.nodes.length} entities, {snapshot.edges.length} edges]
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 text-caption text-ink-soft">
                <Legend swatch="bg-amber-600" label="Carton" />
                <Legend swatch="bg-green-700" label="Pallet" />
                <Legend swatch="bg-cyan-500" label="Worker" />
                <Legend swatch="bg-red-500" label="Overhang Warning" dashed />
              </div>
            </div>

            {/* Views Container */}
            <div className="relative mt-4">
              {loading && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface/75 text-caption text-ink font-medium">
                  <span className="h-4 w-4 animate-spin border-2 border-ink border-t-transparent mr-2" />
                  Calculating 2D world model scene graph & stability…
                </div>
              )}

              {/* View Layout Switcher */}
              {viewMode === 'cad' && (
                <CadCanvas
                  snapshot={snapshot}
                  zones={zones}
                  selectedEntityId={selectedEntityId}
                  hoveredEntityId={hoveredEntityId}
                  onSelectEntity={setSelectedEntityId}
                  onHoverEntity={setHoveredEntityId}
                />
              )}

              {viewMode === 'split' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <div className="text-caption font-semibold uppercase tracking-wider text-ink-soft flex items-center justify-between">
                      <span>2D CAD Blueprint Digital Twin</span>
                      <span className="font-mono text-[11px] text-ink-faint">160 × 90</span>
                    </div>
                    <CadCanvas
                      snapshot={snapshot}
                      zones={zones}
                      selectedEntityId={selectedEntityId}
                      hoveredEntityId={hoveredEntityId}
                      onSelectEntity={setSelectedEntityId}
                      onHoverEntity={setHoveredEntityId}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="text-caption font-semibold uppercase tracking-wider text-ink-soft flex items-center justify-between">
                      <span>Synchronized Optical CCTV Frame</span>
                      <span className="font-mono text-[11px] text-ink-faint">{fmt(timestamp)}</span>
                    </div>
                    <div className="relative aspect-[16/9] w-full border border-line bg-black overflow-hidden flex items-center justify-center">
                      <img
                        key={`${selectedId}-${timestamp}`}
                        src={frameUrl(selectedId, timestamp)}
                        alt="Optical CCTV frame"
                        className="h-full w-full object-contain"
                        onError={(e) => {
                          e.target.style.display = 'none'
                        }}
                      />
                      <div className="absolute top-2 left-2 border border-ok/40 bg-ok/80 px-2 py-0.5 text-[10px] font-mono text-paper font-semibold uppercase">
                        LIVE SYNC · {selectedId?.slice(0, 8)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {viewMode === 'pip' && (
                <div className="relative">
                  <CadCanvas
                    snapshot={snapshot}
                    zones={zones}
                    selectedEntityId={selectedEntityId}
                    hoveredEntityId={hoveredEntityId}
                    onSelectEntity={setSelectedEntityId}
                    onHoverEntity={setHoveredEntityId}
                  />

                  {/* Floating PIP Window in Top Right */}
                  <div className="absolute top-3 right-3 z-10 w-64 aspect-[16/9] border-2 border-line-strong bg-black shadow-lg overflow-hidden">
                    <img
                      key={`${selectedId}-${timestamp}`}
                      src={frameUrl(selectedId, timestamp)}
                      alt="Optical CCTV frame"
                      className="h-full w-full object-contain"
                    />
                    <div className="absolute bottom-1 left-1.5 bg-ink/80 px-1.5 py-0.5 text-[9px] font-mono text-paper">
                      CCTV SYNC {fmt(timestamp)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Canvas Legend & Calibration Disclaimer */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-caption text-ink-soft">
              <div className="flex items-center gap-3">
                <span className="font-medium text-ink">Edge Mechanics:</span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-0.5 w-4 bg-emerald-500" />
                  Support (Gravity Load)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-0.5 w-4 bg-cyan-400" />
                  Contact (Lateral)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-0.5 w-4 border-b border-dashed border-amber-400" />
                  Proximity (Buffer)
                </span>
              </div>
              <span className="font-mono text-[11px] text-ink-faint">
                Normalized coordinate space mapped to calibrated warehouse grid
              </span>
            </div>
          </div>
        </div>

        {/* Right: Interactive Entity Inspector Drawer */}
        {selectedEntityId && selectedNode && (
          <div className="lg:col-span-4 flex flex-col gap-4">
            <EntityInspector
              node={selectedNode}
              snapshot={snapshot}
              zones={zones}
              findings={findings}
              onClose={() => setSelectedEntityId(null)}
              navigateTo={navigateTo}
              videoId={selectedId}
              timestamp={timestamp}
              scenarioKey={scenarioInfo?.scenarioKey}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// 16:9 Industrial Blueprint Canvas SVG
function CadCanvas({
  snapshot,
  zones,
  selectedEntityId,
  hoveredEntityId,
  onSelectEntity,
  onHoverEntity,
}) {
  const nodes = snapshot?.nodes ?? []
  const edges = snapshot?.edges ?? []
  const nodeById = useMemo(() => Object.fromEntries(nodes.map((n) => [n.entity_id, n])), [nodes])

  return (
    <div className="relative w-full aspect-[16/9] border border-line bg-[#070b14] overflow-hidden select-none">
      <svg
        viewBox="0 0 160 90"
        className="w-full h-full cursor-crosshair"
        role="img"
        aria-label="16:9 2D CAD Structural Digital Twin"
      >
        <defs>
          {/* Fine CAD Grid Pattern */}
          <pattern id="cad-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#162137" strokeWidth="0.25" />
            <circle cx="10" cy="10" r="0.4" fill="#1e293b" />
          </pattern>

          {/* Subdivided Grid Pattern */}
          <pattern id="cad-subgrid" width="2" height="2" patternUnits="userSpaceOnUse">
            <path d="M 2 0 L 0 0 0 2" fill="none" stroke="#0f172a" strokeWidth="0.1" />
          </pattern>

          {/* Dock Edge Danger Hatch Pattern */}
          <pattern
            id="dock-hazard-hatch"
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="2" height="4" fill="#ef4444" fillOpacity="0.35" />
            <rect x="2" width="2" height="4" fill="#7f1d1d" fillOpacity="0.35" />
          </pattern>

          {/* Wet Floor Blue Slip Pattern */}
          <pattern
            id="wet-floor-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <rect width="3" height="6" fill="#0284c7" fillOpacity="0.3" />
            <rect x="3" width="3" height="6" fill="#0369a1" fillOpacity="0.15" />
          </pattern>

          {/* Load transfer arrow marker */}
          <marker
            id="load-arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 8 5 L 0 9 z" fill="#10b981" />
          </marker>
        </defs>

        {/* 1. Background Grid */}
        <rect width="160" height="90" fill="url(#cad-subgrid)" />
        <rect width="160" height="90" fill="url(#cad-grid)" />

        {/* 2. Calibration Crosshairs at 4 corners */}
        <g stroke="#334155" strokeWidth="0.3">
          <line x1="6" y1="6" x2="14" y2="6" />
          <line x1="10" y1="2" x2="10" y2="10" />
          <line x1="146" y1="6" x2="154" y2="6" />
          <line x1="150" y1="2" x2="150" y2="10" />
          <line x1="6" y1="84" x2="14" y2="84" />
          <line x1="10" y1="80" x2="10" y2="88" />
          <line x1="146" y1="84" x2="154" y2="84" />
          <line x1="150" y1="80" x2="150" y2="88" />
        </g>

        {/* 3. Camera Optical Frustum Cone */}
        <path
          d="M 80 90 L 20 10 L 140 10 Z"
          fill="#06b6d4"
          fillOpacity="0.03"
          stroke="#06b6d4"
          strokeWidth="0.2"
          strokeDasharray="2 2"
        />
        <circle cx="80" cy="88" r="1.5" fill="#06b6d4" fillOpacity="0.4" />
        <text x="80" y="86" fontSize="2.5" fill="#06b6d4" textAnchor="middle" fontMono="true">
          CAM OPTICAL CENTER
        </text>

        {/* 4. Designated Safety Walkway / Floor Boundary */}
        <line
          x1="10"
          y1="75"
          x2="150"
          y2="75"
          stroke="#eab308"
          strokeWidth="0.4"
          strokeDasharray="3 2"
        />
        <text x="14" y="73" fontSize="2.2" fill="#ca8a04" fontMono="true">
          DESIGNATED AISLE TRANSIT LINE
        </text>

        {/* 5. Calibrated Hazard Zones */}
        {zones.map((z) => {
          const isDock = z.zone_type === 'dock_edge'
          const pts = z.polygon.map(([x, y]) => `${(x * 160).toFixed(1)},${(y * 90).toFixed(1)}`).join(' ')
          const [firstX, firstY] = z.polygon[0] || [0, 0]
          return (
            <g key={z.zone_id}>
              <polygon
                points={pts}
                fill={isDock ? 'url(#dock-hazard-hatch)' : 'url(#wet-floor-hatch)'}
                stroke={isDock ? '#ef4444' : '#0284c7'}
                strokeWidth="0.6"
              />
              <text
                x={firstX * 160 + 2}
                y={firstY * 90 + 5}
                fontSize="2.8"
                fontWeight="700"
                fill={isDock ? '#ef4444' : '#38bdf8'}
                fontMono="true"
              >
                {isDock ? '⚠️ DOCK EDGE FALL HAZARD' : '💧 WET FLOOR SLIP ZONE'}
              </text>
            </g>
          )
        })}

        {/* 6. Spatial Relationship Edges */}
        {edges.map((edge, i) => {
          const a = nodeById[edge.source_id]
          const b = nodeById[edge.target_id]
          if (!a || !b) return null

          const x1 = a.position[0] * 160
          const y1 = a.position[1] * 90
          const x2 = b.position[0] * 160
          const y2 = b.position[1] * 90
          const mx = (x1 + x2) / 2
          const my = (y1 + y2) / 2

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
                  stroke={isWarning ? '#ef4444' : '#10b981'}
                  strokeWidth={isWarning ? '0.9' : '0.7'}
                  markerEnd="url(#load-arrow)"
                />
                <rect
                  x={mx - 6}
                  y={my - 2}
                  width="12"
                  height="4"
                  rx="1"
                  fill="#0f172a"
                  stroke={isWarning ? '#ef4444' : '#10b981'}
                  strokeWidth="0.3"
                />
                <text
                  x={mx}
                  y={my + 0.8}
                  fontSize="2.2"
                  fill={isWarning ? '#ef4444' : '#10b981'}
                  textAnchor="middle"
                  fontWeight="600"
                >
                  {overlap}% spt
                </text>
              </g>
            )
          }

          if (edge.edge_type === 'contact') {
            return (
              <line
                key={`edge-${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#38bdf8"
                strokeWidth="0.5"
                strokeDasharray="1.5 1"
              />
            )
          }

          // Proximity
          return (
            <line
              key={`edge-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#f59e0b"
              strokeWidth="0.4"
              strokeDasharray="2 1.5"
            />
          )
        })}

        {/* 7. Entity Nodes */}
        {nodes.map((node) => {
          const isSelected = selectedEntityId === node.entity_id
          const isHovered = hoveredEntityId === node.entity_id
          const palette = NODE_PALETTE[node.entity_class] || DEFAULT_PALETTE
          const [cx, cy] = [node.position[0] * 160, node.position[1] * 90]

          const fp = node.footprint
          const hasFootprint = fp && fp.x2 > fp.x1 && fp.y2 > fp.y1
          const fx = fp ? fp.x1 * 160 : cx - 6
          const fy = fp ? fp.y1 * 90 : cy - 5
          const fw = fp ? (fp.x2 - fp.x1) * 160 : 12
          const fh = fp ? (fp.y2 - fp.y1) * 90 : 10

          // Check if this box is in an overhang / warning state
          const supportEdge = edges.find(
            (e) => e.target_id === node.entity_id && e.edge_type === 'support'
          )
          const hasOverhang = supportEdge && (supportEdge.evidence?.horizontal_overlap_ratio ?? 1) < 0.7

          return (
            <g
              key={node.entity_id}
              onClick={() => onSelectEntity(node.entity_id)}
              onMouseEnter={() => onHoverEntity(node.entity_id)}
              onMouseLeave={() => onHoverEntity(null)}
              className="cursor-pointer transition-all"
            >
              {/* Box / Carton Node */}
              {node.entity_class === 'box' && (
                <g>
                  {/* Overhang Alert Glow */}
                  {hasOverhang && (
                    <rect
                      x={fx - 1.5}
                      y={fy - 1.5}
                      width={fw + 3}
                      height={fh + 3}
                      rx="1"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="0.7"
                      strokeDasharray="2 1"
                      className="animate-pulse"
                    />
                  )}

                  {/* Carton Base Body */}
                  <rect
                    x={fx}
                    y={fy}
                    width={fw}
                    height={fh}
                    rx="0.8"
                    fill={hasOverhang ? '#7f1d1d' : palette.fill}
                    stroke={hasOverhang ? '#ef4444' : palette.border}
                    strokeWidth={isSelected ? '0.9' : '0.5'}
                  />

                  {/* Center Sealing Tape */}
                  <line
                    x1={fx + fw / 2}
                    y1={fy}
                    x2={fx + fw / 2}
                    y2={fy + fh}
                    stroke={palette.tape}
                    strokeWidth="0.4"
                  />

                  {/* Box Center-of-Gravity Crosshair */}
                  <circle cx={cx} cy={cy} r="0.8" fill={palette.border} />

                  {/* Monospace Box Label */}
                  <text
                    x={cx}
                    y={cy - 1.5}
                    fontSize="2.4"
                    fontWeight="700"
                    fill="#fef08a"
                    textAnchor="middle"
                  >
                    #{node.entity_id.split('_').pop() || 'BOX'}
                  </text>

                  {hasOverhang && (
                    <text
                      x={cx}
                      y={cy + 3.2}
                      fontSize="2.0"
                      fontWeight="800"
                      fill="#ef4444"
                      textAnchor="middle"
                    >
                      OVERHANG
                    </text>
                  )}
                </g>
              )}

              {/* Pallet Node */}
              {node.entity_class === 'pallet' && (
                <g>
                  {/* Timber Outer Frame */}
                  <rect
                    x={fx}
                    y={fy}
                    width={fw}
                    height={fh}
                    rx="0.5"
                    fill={palette.fill}
                    stroke={palette.border}
                    strokeWidth={isSelected ? '0.9' : '0.6'}
                  />

                  {/* Pallet Wooden Slats (3 horizontal planks) */}
                  <line
                    x1={fx}
                    y1={fy + fh * 0.33}
                    x2={fx + fw}
                    y2={fy + fh * 0.33}
                    stroke={palette.slat}
                    strokeWidth="0.4"
                  />
                  <line
                    x1={fx}
                    y1={fy + fh * 0.66}
                    x2={fx + fw}
                    y2={fy + fh * 0.66}
                    stroke={palette.slat}
                    strokeWidth="0.4"
                  />

                  {/* Pallet ID Label */}
                  <text
                    x={cx}
                    y={cy + 1}
                    fontSize="2.4"
                    fontWeight="700"
                    fill="#86efac"
                    textAnchor="middle"
                  >
                    PALLET #{node.entity_id.split('_').pop()}
                  </text>
                </g>
              )}

              {/* Person / Worker Node */}
              {node.entity_class === 'person' && (
                <g>
                  {/* 1.2m Safety Proximity Aura */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r="9"
                    fill={palette.halo}
                    stroke={palette.border}
                    strokeWidth="0.3"
                    strokeDasharray="2 1.5"
                  />

                  {/* Worker Beacon Avatar */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r="3.5"
                    fill={palette.fill}
                    stroke={palette.border}
                    strokeWidth={isSelected ? '0.9' : '0.6'}
                  />

                  {/* Directional Heading Gaze Pointer */}
                  <path
                    d={`M ${cx - 1.2} ${cy - 1.5} L ${cx} ${cy - 4.5} L ${cx + 1.2} ${cy - 1.5} Z`}
                    fill={palette.border}
                  />

                  {/* Worker ID Tag */}
                  <text
                    x={cx}
                    y={cy + 1}
                    fontSize="2.2"
                    fontWeight="700"
                    fill="#e0f2fe"
                    textAnchor="middle"
                  >
                    W-{node.entity_id.split('_').pop()}
                  </text>
                </g>
              )}

              {/* Generic / Equipment Node */}
              {node.entity_class !== 'box' &&
                node.entity_class !== 'pallet' &&
                node.entity_class !== 'person' && (
                  <g>
                    <rect
                      x={fx}
                      y={fy}
                      width={fw}
                      height={fh}
                      fill={palette.fill}
                      stroke={palette.border}
                      strokeWidth="0.5"
                    />
                    <text
                      x={cx}
                      y={cy + 1}
                      fontSize="2.4"
                      fill={palette.border}
                      textAnchor="middle"
                    >
                      {node.entity_class}
                    </text>
                  </g>
                )}

              {/* High-Tech Reticle when Selected */}
              {isSelected && (
                <g stroke="#06b6d4" strokeWidth="0.6" fill="none">
                  {/* Corner brackets */}
                  <path d={`M ${fx - 2} ${fy + 2} L ${fx - 2} ${fy - 2} L ${fx + 2} ${fy - 2}`} />
                  <path d={`M ${fx + fw - 2} ${fy - 2} L ${fx + fw + 2} ${fy - 2} L ${fx + fw + 2} ${fy + 2}`} />
                  <path d={`M ${fx - 2} ${fy + fh - 2} L ${fx - 2} ${fy + fh + 2} L ${fx + 2} ${fy + fh + 2}`} />
                  <path d={`M ${fx + fw - 2} ${fy + fh + 2} L ${fx + fw + 2} ${fy + fh + 2} L ${fx + fw + 2} ${fy + fh - 2}`} />
                  {/* Selected target coordinate readout */}
                  <text
                    x={fx}
                    y={fy - 3.5}
                    fontSize="2.2"
                    fill="#06b6d4"
                    fontMono="true"
                    fontWeight="600"
                  >
                    TARGET: {node.entity_id} [{(node.position[0] * 160).toFixed(0)},{(node.position[1] * 90).toFixed(0)}]
                  </text>
                </g>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// Interactive Entity Inspector Drawer
function EntityInspector({
  node,
  snapshot,
  zones,
  findings,
  onClose,
  navigateTo,
  videoId,
  timestamp,
  scenarioKey,
}) {
  const edges = snapshot?.edges ?? []
  const nodeById = useMemo(
    () => Object.fromEntries((snapshot?.nodes ?? []).map((n) => [n.entity_id, n])),
    [snapshot]
  )

  // Find incoming & outgoing support relationships
  const supportedByEdge = edges.find(
    (e) => e.target_id === node.entity_id && e.edge_type === 'support'
  )
  const supportingEdges = edges.filter(
    (e) => e.source_id === node.entity_id && e.edge_type === 'support'
  )

  // Calculate Overhang & Stability
  const overlapRatio = supportedByEdge?.evidence?.horizontal_overlap_ratio ?? 1.0
  const overhangPct = Math.round((1 - overlapRatio) * 100)
  const isOverhanging = overhangPct > 20

  // Calculate distance to nearest dock edge hazard zone
  const cx = node.position[0]
  const cy = node.position[1]

  let minDockDist = 999
  zones
    .filter((z) => z.zone_type === 'dock_edge')
    .forEach((z) => {
      z.polygon.forEach(([px, py]) => {
        const d = Math.hypot(cx - px, cy - py)
        if (d < minDockDist) minDockDist = d
      })
    })
  const dockMeters = (minDockDist * 10).toFixed(1)
  const dockViolation = minDockDist < 0.15 // < 1.5m buffer

  // Calculate node stability
  let nodeStability = 95
  if (isOverhanging) nodeStability = Math.max(30, 95 - overhangPct * 1.5)
  if (dockViolation) nodeStability = Math.min(nodeStability, 45)

  return (
    <div className="border border-line bg-surface p-4 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-small font-bold text-ink">{node.entity_id}</span>
            <span className="border border-line bg-paper px-2 py-0.5 text-caption font-semibold uppercase tracking-wider text-ink">
              {node.entity_class}
            </span>
          </div>
          <p className="mt-0.5 text-caption text-ink-soft">
            Tracking ID: {node.entity_id} · World Model Layer (Phase 4)
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="border border-line bg-paper px-2 py-1 text-caption text-ink-soft hover:text-ink"
        >
          ✕
        </button>
      </div>

      {/* Stability Assessment Card */}
      <div className="border border-line bg-paper p-3">
        <div className="flex items-center justify-between">
          <span className="text-caption font-semibold text-ink-soft uppercase tracking-wider flex items-center gap-1.5">
            <Scale size={13} />
            Physical Stability Score
          </span>
          <span
            className={`font-mono text-small font-bold ${
              nodeStability < 60 ? 'text-danger' : nodeStability < 80 ? 'text-warn' : 'text-ok'
            }`}
          >
            {Math.round(nodeStability)}%
          </span>
        </div>

        {/* Stability Meter Bar */}
        <div className="mt-2 h-2 w-full bg-line overflow-hidden">
          <div
            style={{ width: `${nodeStability}%` }}
            className={`h-full ${
              nodeStability < 60 ? 'bg-danger' : nodeStability < 80 ? 'bg-warn' : 'bg-ok'
            }`}
          />
        </div>

        <div className="mt-2 text-caption text-ink-soft">
          {isOverhanging ? (
            <span className="text-danger font-medium flex items-center gap-1">
              <AlertTriangle size={12} />
              Unstable load: {overhangPct}% base overhang exceeds safety threshold.
            </span>
          ) : (
            <span className="text-ok font-medium flex items-center gap-1">
              <CheckCircle2 size={12} />
              Load fully supported by foundation base.
            </span>
          )}
        </div>
      </div>

      {/* Footprint & Coordinates */}
      <div className="space-y-1.5 text-caption">
        <div className="font-semibold text-ink uppercase tracking-wider text-[11px]">
          Spatial Footprint & Calibration
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-ink-soft bg-paper border border-line p-2.5">
          <div>
            Center X: <span className="text-ink">{(node.position[0] * 160).toFixed(1)}u</span>
          </div>
          <div>
            Center Y: <span className="text-ink">{(node.position[1] * 90).toFixed(1)}u</span>
          </div>
          {node.footprint && (
            <>
              <div>
                Width: <span className="text-ink">{((node.footprint.x2 - node.footprint.x1) * 160).toFixed(1)}u</span>
              </div>
              <div>
                Depth: <span className="text-ink">{((node.footprint.y2 - node.footprint.y1) * 90).toFixed(1)}u</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Structural Hierarchy Tree */}
      <div className="space-y-1.5 text-caption">
        <div className="font-semibold text-ink uppercase tracking-wider text-[11px]">
          Mechanical Hierarchy
        </div>
        <div className="space-y-1 bg-paper border border-line p-2.5 text-ink-soft">
          {supportedByEdge ? (
            <div className="flex items-center justify-between">
              <span>Supported by:</span>
              <span className="font-mono font-semibold text-ink">
                {supportedByEdge.source_id} ({(overlapRatio * 100).toFixed(0)}% contact)
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span>Supported by:</span>
              <span className="font-semibold text-ink">Warehouse Floor Deck</span>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-line/60 pt-1">
            <span>Supporting child tiers:</span>
            <span className="font-mono font-semibold text-ink">
              {supportingEdges.length > 0
                ? supportingEdges.map((e) => e.target_id).join(', ')
                : 'None (Top Tier)'}
            </span>
          </div>
        </div>
      </div>

      {/* Hazard Zone Clearance */}
      <div className="space-y-1.5 text-caption">
        <div className="font-semibold text-ink uppercase tracking-wider text-[11px]">
          Hazard Zone Clearances
        </div>
        <div className="bg-paper border border-line p-2.5 space-y-1 text-ink-soft">
          <div className="flex items-center justify-between">
            <span>Dock Edge Clearance:</span>
            <span
              className={`font-mono font-semibold ${
                dockViolation ? 'text-danger' : 'text-ok'
              }`}
            >
              {dockMeters}m {dockViolation ? '(BUFFER BREACH)' : '(SAFE)'}
            </span>
          </div>
        </div>
      </div>

      {/* Action Shortcut Buttons */}
      <div className="border-t border-line pt-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={() =>
            navigateTo('What-If Replay', {
              videoId,
              timestamp,
              scenario: scenarioKey,
              entityId: node.entity_id,
            })
          }
          className="w-full flex items-center justify-center gap-1.5 border border-ink bg-ink px-3 py-2 text-small font-semibold text-paper hover:bg-ink-soft transition-colors"
        >
          <Sparkles size={14} />
          Simulate in What-If Replay →
        </button>
        <button
          type="button"
          onClick={() =>
            navigateTo('Incident Replay', {
              videoId,
              timestamp,
            })
          }
          className="w-full flex items-center justify-center gap-1.5 border border-line bg-paper px-3 py-2 text-small font-medium text-ink hover:border-ink transition-colors"
        >
          <RotateCcw size={13} />
          Inspect in Incident Replay →
        </button>
      </div>
    </div>
  )
}

function Legend({ swatch, label, dashed }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`h-2.5 w-2.5 ${swatch} ${
          dashed ? 'border-b-2 border-dashed border-red-500 bg-transparent' : ''
        }`}
      />
      {label}
    </span>
  )
}

