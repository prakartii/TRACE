import { useEffect, useMemo, useState } from 'react'
import { Boxes } from 'lucide-react'
import { getScene, listVideos, listZones } from '../api/videos.js'
import { getVideoScenarioInfo } from '../lib/scenarios.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'

const NODE_COLOR = {
  person: '#18181b',
  box: '#C28208',
  pallet: '#4d7c0f',
  trolley: '#0369a1',
  vehicle_bed: '#475569',
}
const DEFAULT_NODE_COLOR = '#71717a'

const EDGE_STYLE = {
  support: { stroke: '#18181b', width: 0.8, dash: undefined },
  contact: { stroke: '#52525b', width: 0.5, dash: undefined },
  proximity: { stroke: '#a1a1aa', width: 0.35, dash: '1.5 1' },
}

const ZONE_STYLE = {
  dock_edge: { fill: '#B23A22', label: 'dock edge hazard' },
  wet_floor: { fill: '#0369a1', label: 'wet floor hazard' },
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
  const [error, setError] = useState(null)

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
  const info = selectedVideo ? getVideoScenarioInfo(selectedVideo.id || selectedVideo.filename) : null

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getScene(selectedId, timestamp, model)
      .then((snap) => {
        if (!cancelled) setSnapshot(snap)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load scene graph')
          setSnapshot(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, timestamp, model])

  const duration = selectedVideo?.metadata?.duration ?? 0
  const nodeById = useMemo(
    () => Object.fromEntries((snapshot?.nodes ?? []).map((n) => [n.entity_id, n])),
    [snapshot]
  )

  const zonePolygons = zones.map((z) => ({
    id: z.zone_id,
    type: z.zone_type,
    points: z.polygon.map(([x, y]) => `${(x * 100).toFixed(1)},${(y * 100).toFixed(1)}`).join(' '),
  }))

  return (
    <div className="flex flex-col gap-6 pb-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 flex items-center gap-2 text-label font-medium text-ink-soft">
            <Boxes size={13} />
            digital twin — 2D structural state
          </p>
          <h1 className="font-display text-display-lg font-semibold text-ink">Structural view</h1>
          <p className="mt-2 max-w-2xl text-body text-ink-soft">
            Top-down scene graph of the current frame: entity footprints, support / contact /
            proximity relationships, and calibrated hazard zones.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigateTo('Live View', { videoId: selectedId, timestamp })}
          className="border border-line bg-surface px-4 py-2 text-small font-medium text-ink transition-colors hover:border-line-strong"
        >
          open in live view →
        </button>
      </section>

      <section className="grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-3">
        <Field label="camera / zone">
          <select
            value={selectedId ?? ''}
            onChange={(e) => {
              setSelectedId(e.target.value)
              setTimestamp(0)
            }}
            className="border border-line bg-surface px-2.5 py-1.5 text-small text-ink focus:border-ink"
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
        </Field>

        <Field label={`frame time ${fmt(timestamp)}`}>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.5}
            value={Math.min(timestamp, duration || 0)}
            onChange={(e) => setTimestamp(parseFloat(e.target.value))}
            className="w-full accent-ink"
          />
        </Field>

        <Field label="perception model">
          <div className="flex gap-1">
            {(['pilot', 'stock']).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModel(m)}
                className={`px-2.5 py-1.5 text-small font-medium transition-colors ${
                  model === m
                    ? 'bg-ink text-paper'
                    : 'border border-line bg-surface text-ink-soft hover:text-ink'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </Field>
      </section>

      {error && (
        <div className="border border-danger bg-danger/5 p-4 text-small text-danger">{error}</div>
      )}

      <div className="border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
          <h2 className="text-small font-semibold text-ink">
            {info?.cameraName ?? 'Scene graph'} — {snapshot ? `${snapshot.nodes.length} entities, ${snapshot.edges.length} relationships` : ''}
          </h2>
          <div className="flex items-center gap-3 text-caption text-ink-soft">
            <Legend swatch="bg-ink" label="support" />
            <Legend swatch="bg-line-strong" label="contact" />
            <Legend swatch="bg-line-strong" label="proximity" dashed />
          </div>
        </div>

        <div className="relative mt-3">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/70 text-caption text-ink-soft">
              computing scene graph…
            </div>
          )}
          <svg viewBox="0 0 100 100" className="w-full border border-line bg-paper" role="img" aria-label="2D structural scene graph">
            {zonePolygons.map((z) => {
              const style = ZONE_STYLE[z.type] || ZONE_STYLE.dock_edge
              return (
                <polygon
                  key={z.id}
                  points={z.points}
                  fill={style.fill}
                  fillOpacity={0.12}
                  stroke={style.fill}
                  strokeWidth={0.3}
                />
              )
            })}

            {(snapshot?.edges ?? []).map((edge, i) => {
              const a = nodeById[edge.source_id]
              const b = nodeById[edge.target_id]
              if (!a || !b) return null
              const style = EDGE_STYLE[edge.edge_type] ?? EDGE_STYLE.proximity
              return (
                <line
                  key={i}
                  x1={a.position[0] * 100}
                  y1={a.position[1] * 100}
                  x2={b.position[0] * 100}
                  y2={b.position[1] * 100}
                  stroke={style.stroke}
                  strokeWidth={style.width}
                  strokeDasharray={style.dash}
                />
              )
            })}

            {(snapshot?.nodes ?? []).map((node) => {
              const color = NODE_COLOR[node.entity_class] ?? DEFAULT_NODE_COLOR
              const [cx, cy] = [node.position[0] * 100, node.position[1] * 100]
              const hasFootprint = node.footprint && node.footprint.x2 > node.footprint.x1
              return (
                <g key={node.entity_id}>
                  {hasFootprint ? (
                    <rect
                      x={node.footprint.x1 * 100}
                      y={node.footprint.y1 * 100}
                      width={(node.footprint.x2 - node.footprint.x1) * 100}
                      height={(node.footprint.y2 - node.footprint.y1) * 100}
                      fill={color}
                      fillOpacity={0.25}
                      stroke={color}
                      strokeWidth={0.5}
                    />
                  ) : (
                    <circle cx={cx} cy={cy} r={2} fill={color} />
                  )}
                  <text
                    x={cx}
                    y={cy - 2}
                    fontSize={3}
                    fontWeight={600}
                    fill={color}
                    stroke="#fff"
                    strokeWidth={0.6}
                    paintOrder="stroke"
                    textAnchor="middle"
                  >
                    {node.entity_class}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2 text-caption text-ink-soft">
          <span className="font-medium text-ink">classes:</span>
          <Legend swatch="bg-[#18181b]" label="person" />
          <Legend swatch="bg-[#C28208]" label="box / carton" />
          <Legend swatch="bg-[#4d7c0f]" label="pallet" />
          <span className="ml-auto text-ink-faint">
            positions are normalized image-space (2D) — not metric survey coordinates
          </span>
        </div>
      </div>

      <p className="text-caption text-ink-faint">
        Stability figures shown elsewhere are comparative operational risk indicators based on
        observed geometry and product metadata — not certified structural engineering calculations.
      </p>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 bg-surface p-3">
      <span className="text-label font-medium text-ink-faint">{label}</span>
      {children}
    </label>
  )
}

function Legend({ swatch, label, dashed }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 ${swatch} ${dashed ? 'opacity-60' : ''}`} />
      {label}
    </span>
  )
}
