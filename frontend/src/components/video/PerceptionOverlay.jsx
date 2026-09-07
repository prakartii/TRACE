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
  box: '#b45309', // muted amber — carton / cargo
  pallet: '#4d7c0f', // muted olive — wood pallet base
  trolley: '#0369a1', // blue — cart / trolley
  vehicle_bed: '#475569', // slate — vehicle bed
}
const DEFAULT_COLOR = '#71717a'

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

        return (
          <div
            key={entity.id}
            className="absolute border-[1.5px]"
            style={{ left, top, width, height, borderColor: color }}
          >
            <span
              className="absolute left-0 top-0 -translate-y-full inline-flex items-center gap-1.5 whitespace-nowrap px-1.5 py-0.5 text-[10px] leading-tight text-white shadow-sm font-sans"
              style={{ backgroundColor: color }}
            >
              <span className="font-bold">{opLabel}</span>
              {shortTrackId && (
                <span className="font-mono text-[9px] opacity-80">{shortTrackId}</span>
              )}
              <span className="font-mono text-[9px] opacity-80">{Math.round(entity.confidence * 100)}%</span>
              {entity.tracking_status && entity.tracking_status !== 'TRACKED' && (
                <span
                  className={`px-1 py-[1px] text-[8.5px] font-bold uppercase tracking-wider rounded-sm ${
                    entity.tracking_status === 'REACQUIRED'
                      ? 'bg-emerald-500 text-white shadow-sm ring-1 ring-white'
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
