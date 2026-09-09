// Obscures personnel head regions on top of the raw streamed <video>
// (Responsible AI — CLAUDE.md §22). TRACE's still-frame endpoint blurs
// server-side; the streamed MP4 is not transcoded, so the live view redacts
// at the presentation layer here until a server-side transcode exists.
//
// Head region is derived geometrically from the person bounding box the
// pipeline already produces — the top slice, centred — mirroring
// backend/perception/redaction.py::head_region. No face model, no identity.
// `backdrop-filter: blur` genuinely obscures the pixels beneath in the browser.
//
// Fails CLOSED: while person detections are unavailable (`degraded` — no data
// yet, or the perception fetch errored), the whole frame is blurred rather
// than leaving faces visible.
const HEAD_FRACTION = 0.35
const HEAD_WIDTH_FRACTION = 0.85
const PAD = 0.12

export default function FaceRedactionOverlay({
  entities,
  frame,
  sourceWidth,
  sourceHeight,
  displayWidth,
  displayHeight,
  enabled = true,
  degraded = false,
}) {
  if (!enabled) return null

  const resolved = entities || frame?.entities || (Array.isArray(frame) ? frame : [])
  const people = resolved?.filter((e) => e.entity_class === 'person' && e.bbox) || []

  // Detections unavailable -> blur the entire frame (fail closed).
  if (degraded) {
    return (
      <div
        className="pointer-events-none absolute inset-0 flex items-start justify-end p-2"
        style={{
          backgroundColor: 'rgba(20,18,14,0.25)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <span className="bg-ink/70 px-1.5 py-0.5 font-mono text-[10px] text-paper">
          faces obscured — person detection unavailable
        </span>
      </div>
    )
  }

  if (!people.length || !sourceWidth || !sourceHeight || !displayWidth || !displayHeight) {
    return null
  }

  const scaleX = displayWidth / sourceWidth
  const scaleY = displayHeight / sourceHeight

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {people.map((p) => {
        const { x1, y1, x2, y2 } = p.bbox
        const bw = Math.max(0, x2 - x1)
        const bh = Math.max(0, y2 - y1)
        const cx = (x1 + x2) / 2
        const headH = bh * HEAD_FRACTION
        const halfW = (bw * HEAD_WIDTH_FRACTION) / 2
        const rx1 = Math.max(0, cx - halfW - halfW * 2 * PAD)
        const rx2 = Math.min(sourceWidth, cx + halfW + halfW * 2 * PAD)
        const ry1 = Math.max(0, y1 - headH * PAD)
        const ry2 = Math.min(sourceHeight, y1 + headH + headH * PAD)

        const left = rx1 * scaleX
        const top = ry1 * scaleY
        const width = (rx2 - rx1) * scaleX
        const height = (ry2 - ry1) * scaleY
        if (width <= 0 || height <= 0) return null

        return (
          <div
            key={`redact-${p.id}`}
            className="absolute"
            style={{
              left,
              top,
              width,
              height,
              backgroundColor: 'rgba(20,18,14,0.55)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
            }}
          />
        )
      })}
    </div>
  )
}
