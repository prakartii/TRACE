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
  person: '#18181b', // ink — the well-understood, production class
  box: '#b45309', // muted amber — cardboard/carton
  pallet: '#4d7c0f', // muted olive — wood
}
const DEFAULT_COLOR = '#71717a'

export default function PerceptionOverlay({ entities, sourceWidth, sourceHeight, displayWidth, displayHeight }) {
  if (!entities?.length || !sourceWidth || !sourceHeight || !displayWidth || !displayHeight) {
    return null
  }

  const scaleX = displayWidth / sourceWidth
  const scaleY = displayHeight / sourceHeight

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {entities.map((entity) => {
        const { x1, y1, x2, y2 } = entity.bbox
        const left = x1 * scaleX
        const top = y1 * scaleY
        const width = (x2 - x1) * scaleX
        const height = (y2 - y1) * scaleY
        const color = CLASS_COLOR[entity.entity_class] ?? DEFAULT_COLOR

        return (
          <div
            key={entity.id}
            className="absolute border-[1.5px]"
            style={{ left, top, width, height, borderColor: color }}
          >
            <span
              className="absolute left-0 top-0 -translate-y-full whitespace-nowrap px-1 py-0.5 text-[10px] font-medium leading-tight text-white"
              style={{ backgroundColor: color }}
            >
              {entity.entity_class} {Math.round(entity.confidence * 100)}% · id {entity.track_id}
            </span>
          </div>
        )
      })}
    </div>
  )
}
