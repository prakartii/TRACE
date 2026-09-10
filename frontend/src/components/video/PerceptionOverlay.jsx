// Renders detection + tracking boxes over the video (Phase 3, class
// colors added in Phase 4 once box/pallet became real detectable
// classes — see training/README.md). Purely presentational — all
// detection/tracking happens server-side (backend/perception/).
// Coordinates in `entities[].bbox` are absolute pixels in the source
// video's native resolution (sourceWidth/Height); this component scales
// them into the video element's displayed size.
//
// Colors distinguish entity class only — restrained, not a risk/hazard
// signal (CLAUDE.md: no color-coded "AI" effects, and a detection is
// never a hazard claim). Muted, desaturated tones rather than bright
// primaries to stay within the existing industrial/professional palette.
const CLASS_COLOR = {
  person: '#18181b', // ink — personnel
  box: '#C28208', // signal amber — carton / cargo
  pallet: '#4d7c0f', // muted olive — wood pallet base
  trolley: '#0369a1', // blue — cart / trolley
  vehicle_bed: '#475569', // slate — vehicle bed
  forklift: '#B23A22', // danger red — powered equipment
}
const DEFAULT_COLOR = '#71717a'

// COCO 17-keypoint skeleton — mirrors backend/perception/pose.py COCO_LIMBS.
const POSE_LIMBS = [
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [0, 6],
]

function formatShortTrackId(trackId) {
  if (!trackId) return ''
  const str = String(trackId)
  if (str.includes(':')) {
    const part = str.split(':').pop()
    return `#${part}`
  }
  return `#${str}`
}

function getEntityOperationalLabel(entity, allEntities) {
  if (entity.label) return entity.label
  if (entity.role) return entity.role
  if (entity.entity_class === 'person') return 'Worker'
  if (entity.entity_class === 'pallet') return 'Pallet Base'
  if (entity.entity_class === 'trolley') return 'Cart / Trolley'
  if (entity.entity_class === 'vehicle_bed') return 'Vehicle Bed'

  if (entity.entity_class === 'box') {
    const otherBoxes = allEntities.filter((e) => e.entity_class === 'box' && e.id !== entity.id)
    if (otherBoxes.length > 0) {
      const isAboveAnother = otherBoxes.some((other) => {
        const verticalContact = entity.bbox.y2 <= other.bbox.y2 && entity.bbox.y1 < other.bbox.y1
        const overlapX1 = Math.max(entity.bbox.x1, other.bbox.x1)
        const overlapX2 = Math.min(entity.bbox.x2, other.bbox.x2)
        return verticalContact && overlapX2 - overlapX1 > 15
      })
      if (isAboveAnother) return 'Upper Carton'

      const isBelowAnother = otherBoxes.some((other) => {
        const verticalContact = entity.bbox.y2 >= other.bbox.y2 && entity.bbox.y1 > other.bbox.y1
        const overlapX1 = Math.max(entity.bbox.x1, other.bbox.x1)
        const overlapX2 = Math.min(entity.bbox.x2, other.bbox.x2)
        return verticalContact && overlapX2 - overlapX1 > 15
      })
      if (isBelowAnother) return 'Supporting Carton'
    }
    return 'Carton'
  }

  return entity.entity_class || 'Object'
}

export default function PerceptionOverlay({
  entities,
  frame,
  sourceWidth,
  sourceHeight,
  displayWidth,
  displayHeight,
}) {
  const resolvedEntities = entities || frame?.entities || (Array.isArray(frame) ? frame : [])

  if (!resolvedEntities?.length || !sourceWidth || !sourceHeight || !displayWidth || !displayHeight) {
    return null
  }

  const scaleX = displayWidth / sourceWidth
  const scaleY = displayHeight / sourceHeight

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {resolvedEntities.map((entity) => {
        const { x1, y1, x2, y2 } = entity.bbox
        const left = x1 * scaleX
        const top = y1 * scaleY
        const width = (x2 - x1) * scaleX
        const height = (y2 - y1) * scaleY
        const color = CLASS_COLOR[entity.entity_class] ?? DEFAULT_COLOR
        const opLabel = getEntityOperationalLabel(entity, resolvedEntities)
        const shortTrackId = formatShortTrackId(entity.track_id)
        const keypoints = entity.keypoints

        return (
          <div
            key={entity.id}
            className="absolute border-[1.5px]"
            style={{ left, top, width, height, borderColor: color }}
          >
            {keypoints && keypoints.length > 0 && (
              <Skeleton
                keypoints={keypoints}
                originX={x1}
                originY={y1}
                scaleX={scaleX}
                scaleY={scaleY}
                color={color}
              />
            )}
            <span
              className="absolute left-0 top-0 -translate-y-full inline-flex items-center gap-1.5 whitespace-nowrap px-1.5 py-0.5 text-caption leading-tight text-white font-sans"
              style={{ backgroundColor: color }}
            >
              <span className="font-bold">{opLabel}</span>
              {shortTrackId && (
                <span className="font-mono text-[9px] opacity-80">{shortTrackId}</span>
              )}
              <span className="font-mono text-[9px] opacity-80">{Math.round(entity.confidence * 100)}%</span>
              {entity.tracking_status && entity.tracking_status !== 'TRACKED' && (
                <span
                  className={`px-1 py-[1px] text-[8.5px] font-bold tracking-wide ${
                    entity.tracking_status === 'REACQUIRED'
                      ? 'bg-emerald-500 text-white ring-1 ring-white'
                      : entity.tracking_status === 'TEMPORARILY_LOST'
                        ? 'bg-amber-400 text-neutral-950 font-semibold'
                        : 'bg-white/20 text-neutral-100'
                  }`}
                >
                  {entity.tracking_status}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Skeleton({ keypoints, originX, originY, scaleX, scaleY, color }) {
  const pts = keypoints.map(([kx, ky]) => [(kx - originX) * scaleX, (ky - originY) * scaleY])
  const lines = POSE_LIMBS.filter(([a, b]) => pts[a] && pts[b])
    .map(([a, b]) => ({ x1: pts[a][0], y1: pts[a][1], x2: pts[b][0], y2: pts[b][1] }))
    .filter((l) => [l.x1, l.y1, l.x2, l.y2].every((v) => Number.isFinite(v)))

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ overflow: 'visible' }}>
      {lines.map((l, i) => (
        <line
          key={i}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0.9}
        />
      ))}
      {pts.map(([x, y], i) =>
        Number.isFinite(x) && Number.isFinite(y) ? (
          <circle key={i} cx={x} cy={y} r={2} fill={color} stroke="#fff" strokeWidth={0.5} />
        ) : null
      )}
    </svg>
  )
}
