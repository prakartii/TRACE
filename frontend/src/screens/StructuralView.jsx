import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes,
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Eye,
  Columns,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Camera,
  Layers,
} from 'lucide-react'
import { getScene, listVideos, listZones, frameUrl } from '../api/videos.js'
import { getVideoScenarioInfo } from '../lib/scenarios.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'

// Clean color palette for 2D Warehouse Blueprint
const PALETTE = {
  box: {
    fill: '#78350f',
    stroke: '#f59e0b',
    text: '#fef08a',
    label: 'Box',
  },
  pallet: {
    fill: '#14532d',
    stroke: '#22c55e',
    text: '#86efac',
    label: 'Pallet',
  },
  person: {
    fill: '#083344',
    stroke: '#06b6d4',
    text: '#e0f2fe',
    label: 'Worker',
  },
  trolley: {
    fill: '#0f172a',
    stroke: '#38bdf8',
    text: '#bae6fd',
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
  const [selectedId, setSelectedId] = useState(null)
  const [timestamp, setTimestamp] = useState(0)
  const [model, setModel] = useState('pilot')
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [hoveredNode, setHoveredNode] = useState(null)

  // Clean UI toggles
  const [splitView, setSplitView] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const playTimerRef = useRef(null)

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

  const selectedVideo = videos.find((v) => v.id === selectedId) ?? null
  const duration = selectedVideo?.metadata?.duration ?? 0
  const scenarioInfo = selectedVideo ? getVideoScenarioInfo(selectedVideo.id || selectedVideo.filename) : null

  // Fetch 2D scene graph for selected camera and time
  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setLoading(true)

    getScene(selectedId, timestamp, model)
      .then((snap) => {
        if (!cancelled) setSnapshot(snap)
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedId, timestamp, model])

  // Playback timer
  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current) clearInterval(playTimerRef.current)
      return
    }

    playTimerRef.current = setInterval(() => {
      setTimestamp((t) => {
        const next = Math.round((t + 0.5) * 10) / 10
        if (next > (duration || 10)) return 0
        return next
      })
    }, 500)

    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current)
    }
  }, [isPlaying, duration])

  const handleStep = (delta) => {
    setIsPlaying(false)
    setTimestamp((t) => {
      const next = Math.max(0, Math.min(duration || 10, Math.round((t + delta) * 10) / 10))
      return next
    })
  }

  // Safety status logic in simple English
  const safetyStatus = useMemo(() => {
    if (!selectedVideo) return { status: 'Normal', color: 'text-ok', text: 'All operations normal' }
    const scen = (scenarioInfo?.scenarioKey || '').toLowerCase()
    if (scen.includes('dock')) {
      return {
        level: 'Alert',
        bg: 'border-danger/40 bg-danger/10 text-danger',
        title: 'Too close to dock edge',
        action: 'Keep boxes and workers at least 1.5 meters away from the dock ledge.',
      }
    }
    if (scen.includes('overhang') || scen.includes('heavy_on_light')) {
      return {
        level: 'Warning',
        bg: 'border-warn/40 bg-warn/10 text-warn',
        title: 'Box overhanging pallet edge',
        action: 'Push the box inward so it rests securely on the pallet deck.',
      }
    }
    if (scen.includes('wet')) {
      return {
        level: 'Hazard',
        bg: 'border-sky-500/40 bg-sky-500/10 text-sky-600',
        title: 'Wet floor spill area',
        action: 'Walk slowly and wipe up spills before wheeling heavy carts through.',
      }
    }
    if (scen.includes('drop') || scen.includes('throw')) {
      return {
        level: 'Warning',
        bg: 'border-warn/40 bg-warn/10 text-warn',
        title: 'Package handling caution',
        action: 'Lower packages gently with both hands. Do not drop or throw boxes.',
      }
    }
    if (scen.includes('step')) {
      return {
        level: 'Warning',
        bg: 'border-danger/40 bg-danger/10 text-danger',
        title: 'Stepping on boxes',
        action: 'Use a rolling stepladder. Never climb or stand on inventory.',
      }
    }
    return {
      level: 'Safe',
      bg: 'border-ok/40 bg-ok/10 text-ok',
      title: 'Stable Stacking',
      action: 'All cargo is properly balanced on warehouse pallets.',
    }
  }, [selectedVideo, scenarioInfo])

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink text-paper">
              <Boxes size={15} />
            </span>
            <h1 className="font-display text-display font-semibold text-ink">2D Digital Twin</h1>
            <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
              Live Sync
            </span>
          </div>
          <p className="mt-1 text-small text-ink-soft">
            Top-down layout of warehouse cargo and bays, synchronized with security cameras.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigateTo('Live View', { videoId: selectedId, timestamp })}
          className="inline-flex items-center gap-1.5 border border-ink bg-ink px-3.5 py-1.5 text-small font-medium text-paper transition-colors hover:bg-ink-soft"
        >
          <Eye size={13} />
          Full CCTV View →
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
          {scenarioInfo?.cameraName || 'Active Camera'}
        </span>
      </section>

      {/* Controls Bar: Camera Selector, View Mode, Playback */}
      <section className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface p-3 shadow-xs">
        {/* Camera Selector */}
        <div className="flex items-center gap-2">
          <span className="text-caption font-semibold text-ink-soft flex items-center gap-1">
            <Camera size={13} />
            Bay:
          </span>
          <select
            value={selectedId ?? ''}
            onChange={(e) => {
              setSelectedId(e.target.value)
              setTimestamp(0)
              setIsPlaying(false)
            }}
            className="border border-line bg-paper px-2.5 py-1 text-small font-medium text-ink focus:border-ink"
          >
            {videos.map((v) => {
              const vi = getVideoScenarioInfo(v.id || v.filename)
              return (
                <option key={v.id} value={v.id}>
                  {vi.cameraName}
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
            Split (2D + Camera)
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

        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            className="flex h-7 w-7 items-center justify-center border border-ink bg-ink text-paper hover:bg-ink-soft"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => handleStep(-0.5)}
            className="flex h-7 w-7 items-center justify-center border border-line bg-paper text-ink hover:border-ink"
            title="Step Back -0.5s"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            onClick={() => handleStep(0.5)}
            className="flex h-7 w-7 items-center justify-center border border-line bg-paper text-ink hover:border-ink"
            title="Step Forward +0.5s"
          >
            <ChevronRight size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsPlaying(false)
              setTimestamp(0)
            }}
            className="flex h-7 w-7 items-center justify-center border border-line bg-paper text-ink hover:border-ink"
            title="Reset to start"
          >
            <RotateCcw size={12} />
          </button>

          <span className="font-mono text-caption font-semibold text-ink px-1">
            {fmt(timestamp)} <span className="text-ink-faint">/ {fmt(duration)}</span>
          </span>

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
            className="w-28 sm:w-44 accent-ink cursor-pointer ml-1"
          />
        </div>
      </section>

      {/* Main Workstation Screen */}
      <section className="border border-line bg-surface p-4 shadow-xs">
        <div className={`grid grid-cols-1 ${splitView ? 'md:grid-cols-2' : ''} gap-4 items-start`}>
          {/* Left: 2D Blueprint */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-caption font-semibold uppercase tracking-wider text-ink-soft">
              <span>Top-Down Warehouse Blueprint</span>
              {hoveredNode && (
                <span className="text-ink font-mono text-[11px] font-medium lowercase">
                  selected: {hoveredNode}
                </span>
              )}
            </div>

            <div className="relative aspect-[16/9] w-full border border-line bg-[#070b14] overflow-hidden select-none">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/75 text-caption text-ink font-medium">
                  Updating 2D positions…
                </div>
              )}

              <BlueprintMap
                snapshot={snapshot}
                zones={zones}
                onHover={setHoveredNode}
              />
            </div>

            {/* Simple Legend */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-caption text-ink-soft">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 bg-amber-600 rounded-xs" />
                  Box / Cargo
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 bg-green-700 rounded-xs" />
                  Pallet
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 bg-cyan-500 rounded-xs" />
                  Worker
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-danger font-medium">
                  <span className="h-2.5 w-2.5 border border-danger bg-danger/30 rounded-xs" />
                  Dock Edge Hazard
                </span>
                <span className="inline-flex items-center gap-1.5 text-sky-600 font-medium">
                  <span className="h-2.5 w-2.5 border border-sky-500 bg-sky-500/30 rounded-xs" />
                  Wet Floor Hazard
                </span>
              </div>
            </div>
          </div>

          {/* Right: Synchronized Live Camera Frame (if Split View is enabled) */}
          {splitView && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-caption font-semibold uppercase tracking-wider text-ink-soft">
                <span>Synchronized Security Camera</span>
                <span className="font-mono text-[11px] text-ink-faint">{fmt(timestamp)}</span>
              </div>

              <div className="relative aspect-[16/9] w-full border border-line bg-black overflow-hidden flex items-center justify-center">
                <img
                  key={`${selectedId}-${timestamp}`}
                  src={frameUrl(selectedId, timestamp)}
                  alt="Security Camera Feed"
                  className="h-full w-full object-contain"
                  onError={(e) => {
                    e.target.style.display = 'none'
                  }}
                />
                <div className="absolute top-2 left-2 border border-ok/40 bg-ok/80 px-2 py-0.5 text-[10px] font-mono text-paper font-semibold uppercase">
                  LIVE CCTV · {scenarioInfo?.cameraName || 'CAMERA'}
                </div>
              </div>

              <p className="text-caption text-ink-faint pt-1">
                Visual confirmation: The 2D map on the left directly reflects what the camera sees on the right.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

// Clean 2D Blueprint SVG component
function BlueprintMap({ snapshot, zones, onHover }) {
  const nodes = snapshot?.nodes ?? []
  const edges = snapshot?.edges ?? []
  const nodeById = useMemo(() => Object.fromEntries(nodes.map((n) => [n.entity_id, n])), [nodes])

  return (
    <svg
      viewBox="0 0 160 90"
      className="w-full h-full cursor-crosshair"
      role="img"
      aria-label="2D Warehouse Floor Map"
    >
      <defs>
        {/* Subtle Background Grid */}
        <pattern id="twin-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#162137" strokeWidth="0.25" />
        </pattern>

        {/* Dock Hazard Stripes */}
        <pattern
          id="twin-dock-hatch"
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="2" height="4" fill="#ef4444" fillOpacity="0.4" />
          <rect x="2" width="2" height="4" fill="#7f1d1d" fillOpacity="0.4" />
        </pattern>

        {/* Wet Floor Blue Pattern */}
        <pattern
          id="twin-wet-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-45)"
        >
          <rect width="3" height="6" fill="#0284c7" fillOpacity="0.35" />
          <rect x="3" width="3" height="6" fill="#0369a1" fillOpacity="0.2" />
        </pattern>

        {/* Downward Support Arrow */}
        <marker
          id="support-down-arrow"
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto"
        >
          <path d="M 0 2 L 8 5 L 0 8 z" fill="#10b981" />
        </marker>
      </defs>

      {/* Grid */}
      <rect width="160" height="90" fill="#070b14" />
      <rect width="160" height="90" fill="url(#twin-grid)" />

      {/* Corner crosshairs */}
      <g stroke="#334155" strokeWidth="0.25">
        <line x1="4" y1="4" x2="8" y2="4" />
        <line x1="6" y1="2" x2="6" y2="6" />
        <line x1="152" y1="4" x2="156" y2="4" />
        <line x1="154" y1="2" x2="154" y2="6" />
        <line x1="4" y1="86" x2="8" y2="86" />
        <line x1="6" y1="84" x2="6" y2="88" />
        <line x1="152" y1="86" x2="156" y2="86" />
        <line x1="154" y1="84" x2="154" y2="88" />
      </g>

      {/* Floor Walkway Line */}
      <line
        x1="10"
        y1="78"
        x2="150"
        y2="78"
        stroke="#ca8a04"
        strokeWidth="0.3"
        strokeDasharray="3 2"
      />
      <text x="12" y="76.5" fontSize="2.0" fill="#ca8a04" fontMono="true">
        WALKWAY AISLE
      </text>

      {/* Hazard Zones */}
      {zones.map((z) => {
        const isDock = z.zone_type === 'dock_edge'
        const pts = z.polygon.map(([x, y]) => `${(x * 160).toFixed(1)},${(y * 90).toFixed(1)}`).join(' ')
        const [firstX, firstY] = z.polygon[0] || [0, 0]
        return (
          <g key={z.zone_id}>
            <polygon
              points={pts}
              fill={isDock ? 'url(#twin-dock-hatch)' : 'url(#twin-wet-hatch)'}
              stroke={isDock ? '#ef4444' : '#0284c7'}
              strokeWidth="0.6"
            />
            <text
              x={firstX * 160 + 2}
              y={firstY * 90 + 5}
              fontSize="2.6"
              fontWeight="700"
              fill={isDock ? '#ef4444' : '#38bdf8'}
            >
              {isDock ? '⚠️ DOCK EDGE (KEEP 1.5M CLEAR)' : '💧 WET FLOOR SPILL'}
            </text>
          </g>
        )
      })}

      {/* Support Relationships (Arrows) */}
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
                stroke={isWarning ? '#ef4444' : '#10b981'}
                strokeWidth={isWarning ? '0.8' : '0.6'}
                markerEnd="url(#support-down-arrow)"
              />
            </g>
          )
        }
        return null
      })}

      {/* Entity Nodes (Boxes, Pallets, Workers) */}
      {nodes.map((node) => {
        const palette = PALETTE[node.entity_class] || PALETTE.box
        const [cx, cy] = [node.position[0] * 160, node.position[1] * 90]

        const fp = node.footprint
        const fx = fp ? fp.x1 * 160 : cx - 6
        const fy = fp ? fp.y1 * 90 : cy - 5
        const fw = fp ? (fp.x2 - fp.x1) * 160 : 12
        const fh = fp ? (fp.y2 - fp.y1) * 90 : 10

        // Overhang warning check
        const supportEdge = edges.find(
          (e) => e.target_id === node.entity_id && e.edge_type === 'support'
        )
        const hasOverhang = supportEdge && (supportEdge.evidence?.horizontal_overlap_ratio ?? 1) < 0.7

        return (
          <g
            key={node.entity_id}
            onMouseEnter={() =>
              onHover(
                `${palette.label} (${hasOverhang ? 'warning: overhanging edge' : 'safely placed'})`
              )
            }
            onMouseLeave={() => onHover(null)}
            className="cursor-pointer"
          >
            {/* Box */}
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
                    stroke="#ef4444"
                    strokeWidth="0.8"
                    strokeDasharray="2 1"
                    className="animate-pulse"
                  />
                )}
                <rect
                  x={fx}
                  y={fy}
                  width={fw}
                  height={fh}
                  rx="0.8"
                  fill={hasOverhang ? '#7f1d1d' : palette.fill}
                  stroke={hasOverhang ? '#ef4444' : palette.stroke}
                  strokeWidth="0.6"
                />
                <line
                  x1={fx + fw / 2}
                  y1={fy}
                  x2={fx + fw / 2}
                  y2={fy + fh}
                  stroke="#b45309"
                  strokeWidth="0.4"
                />
                <text
                  x={cx}
                  y={cy + 1}
                  fontSize="2.4"
                  fontWeight="700"
                  fill={hasOverhang ? '#fca5a5' : palette.text}
                  textAnchor="middle"
                >
                  {hasOverhang ? 'OVERHANG' : 'BOX'}
                </text>
              </g>
            )}

            {/* Pallet */}
            {node.entity_class === 'pallet' && (
              <g>
                <rect
                  x={fx}
                  y={fy}
                  width={fw}
                  height={fh}
                  rx="0.5"
                  fill={palette.fill}
                  stroke={palette.stroke}
                  strokeWidth="0.6"
                />
                <line
                  x1={fx}
                  y1={fy + fh * 0.33}
                  x2={fx + fw}
                  y2={fy + fh * 0.33}
                  stroke="#166534"
                  strokeWidth="0.4"
                />
                <line
                  x1={fx}
                  y1={fy + fh * 0.66}
                  x2={fx + fw}
                  y2={fy + fh * 0.66}
                  stroke="#166534"
                  strokeWidth="0.4"
                />
                <text
                  x={cx}
                  y={cy + 1}
                  fontSize="2.4"
                  fontWeight="700"
                  fill={palette.text}
                  textAnchor="middle"
                >
                  PALLET
                </text>
              </g>
            )}

            {/* Worker */}
            {node.entity_class === 'person' && (
              <g>
                <circle
                  cx={cx}
                  cy={cy}
                  r="7"
                  fill="rgba(6, 182, 212, 0.15)"
                  stroke="#06b6d4"
                  strokeWidth="0.3"
                  strokeDasharray="2 1.5"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r="3.5"
                  fill={palette.fill}
                  stroke={palette.stroke}
                  strokeWidth="0.6"
                />
                <text
                  x={cx}
                  y={cy + 1}
                  fontSize="2.2"
                  fontWeight="700"
                  fill={palette.text}
                  textAnchor="middle"
                >
                  WORKER
                </text>
              </g>
            )}

            {/* Generic other */}
            {node.entity_class !== 'box' &&
              node.entity_class !== 'pallet' &&
              node.entity_class !== 'person' && (
                <g>
                  <rect
                    x={fx}
                    y={fy}
                    width={fw}
                    height={fh}
                    fill="#1e293b"
                    stroke="#94a3b8"
                    strokeWidth="0.5"
                  />
                  <text
                    x={cx}
                    y={cy + 1}
                    fontSize="2.4"
                    fill="#94a3b8"
                    textAnchor="middle"
                  >
                    {node.entity_class}
                  </text>
                </g>
              )}
          </g>
        )
      })}
    </svg>
  )
}


