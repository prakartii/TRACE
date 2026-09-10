import { useEffect, useRef, useState } from 'react'
import { computeRenderedVideoBounds, parseBbox } from '../../lib/faceGeometry.js'

// Renders detection + tracking boxes over the video (Phase 3, class
// colors added in Phase 4 once box/pallet became real detectable
// classes — see training/README.md). Purely presentational — all
// detection/tracking happens server-side (backend/perception/).
// Coordinates in `entities[].bbox` are absolute pixels in the source
// video's native resolution (sourceWidth/Height); this component scales
// them into the video element's displayed size with exact letterbox alignment.
const CLASS_COLOR = {
  person: '#18181b', // ink — personnel
  box: '#C28208', // signal amber — carton / cargo
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
        const b1 = parseBbox(entity.bbox)
        const b2 = parseBbox(other.bbox)
        if (!b1 || !b2) return false
        const verticalContact = b1.y2 <= b2.y2 && b1.y1 < b2.y1
        const overlapX1 = Math.max(b1.x1, b2.x1)
        const overlapX2 = Math.min(b1.x2, b2.x2)
        return verticalContact && overlapX2 - overlapX1 > 15
      })
      if (isAboveAnother) return 'Upper Carton'

      const isBelowAnother = otherBoxes.some((other) => {
        const b1 = parseBbox(entity.bbox)
        const b2 = parseBbox(other.bbox)
        if (!b1 || !b2) return false
        const verticalContact = b1.y2 >= b2.y2 && b1.y1 > b2.y1
        const overlapX1 = Math.max(b1.x1, b2.x1)
        const overlapX2 = Math.min(b1.x2, b2.x2)
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
  sourceWidth = 1280,
  sourceHeight = 720,
  displayWidth = 0,
  displayHeight = 0,
}) {
  const containerRef = useRef(null)
  const [measuredSize, setMeasuredSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined

    const updateSize = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setMeasuredSize({ width: rect.width, height: rect.height })
      }
    }
    updateSize()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect
          if (width > 0 && height > 0) {
            setMeasuredSize({ width, height })
          }
        }
      })
      observer.observe(el)
      return () => observer.disconnect()
    }
  }, [])

  const resolvedEntities = entities || frame?.entities || (Array.isArray(frame) ? frame : [])

  const effectiveWidth = measuredSize.width || displayWidth || 0
  const effectiveHeight = measuredSize.height || displayHeight || 0

  if (!resolvedEntities?.length) {
    return null
  }

  const { offsetX, offsetY, renderWidth, renderHeight, scaleX, scaleY } =
    computeRenderedVideoBounds(effectiveWidth, effectiveHeight, sourceWidth, sourceHeight)

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 overflow-hidden">
      {effectiveWidth > 0 && effectiveHeight > 0 && (
        <div
          style={{
            position: 'absolute',
            left: `${offsetX}px`,
            top: `${offsetY}px`,
            width: `${renderWidth}px`,
            height: `${renderHeight}px`,
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
        >
          {resolvedEntities.map((entity) => {
            const box = parseBbox(entity.bbox)
            if (!box) return null

            const left = box.x1 * scaleX
            const top = box.y1 * scaleY
            const width = (box.x2 - box.x1) * scaleX
            const height = (box.y2 - box.y1) * scaleY
            const color = CLASS_COLOR[entity.entity_class] ?? DEFAULT_COLOR
            const opLabel = getEntityOperationalLabel(entity, resolvedEntities)

            return (
              <div
                key={entity.id}
                className="absolute border-[1.5px]"
                style={{ left, top, width, height, borderColor: color }}
              >
                <span
                  className="absolute left-0 top-0 -translate-y-full inline-flex items-center whitespace-nowrap px-1.5 py-0.5 text-[11px] font-semibold leading-tight text-white font-sans rounded-xs shadow-xs"
                  style={{ backgroundColor: color }}
                >
                  {opLabel}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
