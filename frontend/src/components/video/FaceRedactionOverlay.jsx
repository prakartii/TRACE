import { useEffect, useRef } from 'react'

// Obscures personnel head regions on top of live/replayed video
// Responsible AI privacy protection: Worker identities are obscured without distorting the scene.
// Fails gracefully: NEVER blurs the entire video monitor. Obscures only detected personnel faces.
const HEAD_HEIGHT_RATIO = 0.28
const HEAD_WIDTH_RATIO = 0.58
const PAD = 0.1

function parseBbox(bbox) {
  if (!bbox) return null
  if (Array.isArray(bbox) && bbox.length >= 4) {
    return { x1: bbox[0], y1: bbox[1], x2: bbox[2], y2: bbox[3] }
  }
  if (typeof bbox.x1 === 'number') {
    return { x1: bbox.x1, y1: bbox.y1, x2: bbox.x2, y2: bbox.y2 }
  }
  return null
}

export default function FaceRedactionOverlay({
  entities,
  frame,
  sourceWidth,
  sourceHeight,
  displayWidth,
  displayHeight,
  enabled = true,
}) {
  const lastPeopleRef = useRef([])
  const lastSeenRef = useRef(0)

  if (!enabled) return null

  const resolved = entities || frame?.entities || (Array.isArray(frame) ? frame : [])
  const livePeople = (resolved || []).filter(
    (e) => (e.entity_class === 'person' || e.class_name === 'person') && (e.bbox || e.bounding_box)
  )

  if (livePeople.length > 0) {
    lastPeopleRef.current = livePeople
    lastSeenRef.current = Date.now()
  }

  // Smooth retention: Keep last known head positions for up to 1.2s during playback intervals
  const now = Date.now()
  const activePeople =
    livePeople.length > 0
      ? livePeople
      : now - lastSeenRef.current < 1200
      ? lastPeopleRef.current
      : []

  if (
    !activePeople.length ||
    !sourceWidth ||
    !sourceHeight ||
    !displayWidth ||
    !displayHeight
  ) {
    return null
  }

  const scaleX = displayWidth / sourceWidth
  const scaleY = displayHeight / sourceHeight

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-20">
      {activePeople.map((p, idx) => {
        const box = parseBbox(p.bbox || p.bounding_box)
        if (!box) return null

        const { x1, y1, x2, y2 } = box
        const bw = Math.max(0, x2 - x1)
        const bh = Math.max(0, y2 - y1)
        if (bw <= 0 || bh <= 0) return null

        const cx = (x1 + x2) / 2
        const headH = Math.max(16, bh * HEAD_HEIGHT_RATIO)
        const headW = Math.max(14, bw * HEAD_WIDTH_RATIO)

        // Center oval around head / face area
        const rx1 = Math.max(0, cx - headW / 2 - headW * PAD)
        const rx2 = Math.min(sourceWidth, cx + headW / 2 + headW * PAD)
        const ry1 = Math.max(0, y1 - headH * PAD * 0.5)
        const ry2 = Math.min(sourceHeight, y1 + headH + headH * PAD)

        const left = rx1 * scaleX
        const top = ry1 * scaleY
        const width = (rx2 - rx1) * scaleX
        const height = (ry2 - ry1) * scaleY
        if (width <= 0 || height <= 0) return null

        return (
          <div
            key={`face-blur-${p.id || p.track_id || idx}`}
            className="absolute rounded-full pointer-events-none transition-all duration-100 ease-out"
            style={{
              left,
              top,
              width,
              height,
              backgroundColor: 'rgba(15, 23, 42, 0.45)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: '0 0 10px rgba(0, 0, 0, 0.35)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
            }}
          />
        )
      })}
    </div>
  )
}
