// Utility functions for video viewport coordinate mapping and posture-aware face/head localization.
// Used by FaceRedactionOverlay and PerceptionOverlay for pixel-perfect alignment.

/**
 * Calculates the exact rendered video rectangle inside a container element,
 * accounting for CSS `object-fit: contain` (letterboxing and pillarboxing).
 */
export function computeRenderedVideoBounds(containerWidth, containerHeight, sourceWidth = 1280, sourceHeight = 720) {
  const sw = Number(sourceWidth) || 1280
  const sh = Number(sourceHeight) || 720
  const cw = Number(containerWidth) || 0
  const ch = Number(containerHeight) || 0

  if (cw <= 0 || ch <= 0 || sw <= 0 || sh <= 0) {
    return {
      offsetX: 0,
      offsetY: 0,
      renderWidth: cw || sw,
      renderHeight: ch || sh,
      scaleX: 1,
      scaleY: 1,
    }
  }

  const videoRatio = sw / sh
  const containerRatio = cw / ch

  let renderWidth = cw
  let renderHeight = ch
  let offsetX = 0
  let offsetY = 0

  if (containerRatio > videoRatio) {
    // Container is wider than the video -> pillarbox (black bars on left & right)
    renderHeight = ch
    renderWidth = ch * videoRatio
    offsetX = (cw - renderWidth) / 2
    offsetY = 0
  } else {
    // Container is taller than the video -> letterbox (black bars on top & bottom)
    renderWidth = cw
    renderHeight = cw / videoRatio
    offsetX = 0
    offsetY = (ch - renderHeight) / 2
  }

  return {
    offsetX,
    offsetY,
    renderWidth,
    renderHeight,
    scaleX: renderWidth / sw,
    scaleY: renderHeight / sh,
  }
}

/**
 * Parse any bounding box representation into standard { x1, y1, x2, y2 }
 */
export function parseBbox(bbox) {
  if (!bbox) return null
  if (Array.isArray(bbox) && bbox.length >= 4) {
    return {
      x1: Number(bbox[0]),
      y1: Number(bbox[1]),
      x2: Number(bbox[2]),
      y2: Number(bbox[3]),
    }
  }
  if (typeof bbox.x1 === 'number' && typeof bbox.y1 === 'number') {
    return {
      x1: Number(bbox.x1),
      y1: Number(bbox.y1),
      x2: Number(bbox.x2),
      y2: Number(bbox.y2),
    }
  }
  return null
}

/**
 * Linearly interpolates between two bounding boxes.
 */
export function lerpBbox(boxA, boxB, alpha) {
  const t = Math.max(0, Math.min(1, alpha))
  return {
    x1: boxA.x1 + (boxB.x1 - boxA.x1) * t,
    y1: boxA.y1 + (boxB.y1 - boxA.y1) * t,
    x2: boxA.x2 + (boxB.x2 - boxA.x2) * t,
    y2: boxA.y2 + (boxB.y2 - boxA.y2) * t,
  }
}

/**
 * Posture-aware calculation of the personnel head & face envelope.
 * 
 * Adapts to worker posture:
 * 1. Upright / standing: head is top ~30% of height, centered.
 * 2. Leaning / reaching: head expands to top ~38% of height.
 * 3. Stooping / crouching / bending (aspect ratio > 0.85):
 *    Spine is horizontal/diagonal; head occupies 46-52% of compressed vertical profile.
 * 
 * Enforces minimum safety dimensions so distant workers' identities are completely protected.
 */
export function calculateHeadRegion(rawBbox, sourceWidth = 1280, sourceHeight = 720) {
  const box = parseBbox(rawBbox)
  if (!box) return null

  const x1 = Math.max(0, Math.min(box.x1, box.x2))
  const y1 = Math.max(0, Math.min(box.y1, box.y2))
  const x2 = Math.min(sourceWidth, Math.max(box.x1, box.x2))
  const y2 = Math.min(sourceHeight, Math.max(box.y1, box.y2))

  const bw = Math.max(0, x2 - x1)
  const bh = Math.max(0, y2 - y1)
  if (bw <= 2 || bh <= 2) return null

  const aspectRatio = bw / bh
  const isStooped = aspectRatio >= 0.85
  const isLeaning = aspectRatio > 0.55 && aspectRatio < 0.85

  let headHeightFraction
  let headWidthFraction
  let padX
  let padY

  if (isStooped) {
    // Worker bent at waist / crouched (e.g. lifting, picking from ground)
    headHeightFraction = 0.48
    headWidthFraction = 0.85
    padX = 0.16
    padY = 0.14
  } else if (isLeaning) {
    // Worker leaning or reaching
    headHeightFraction = 0.38
    headWidthFraction = 0.80
    padX = 0.14
    padY = 0.12
  } else {
    // Upright standing / walking worker
    headHeightFraction = 0.32
    headWidthFraction = 0.78
    padX = 0.12
    padY = 0.10
  }

  // Minimum dimensions in source pixels so distant figures never produce sub-pixel blurs
  const minHeadWidth = 28
  const minHeadHeight = 26

  const rawHeadW = bw * headWidthFraction * (1 + padX * 2)
  const rawHeadH = bh * headHeightFraction * (1 + padY * 2)

  const headW = Math.max(minHeadWidth, rawHeadW)
  const headH = Math.max(minHeadHeight, rawHeadH)

  const cx = (x1 + x2) / 2
  // For upright workers, center of head is in top 15% of body.
  // For stooped workers, center is lower in the compressed frame.
  const cy = y1 + (bh * headHeightFraction * 0.5)

  const hx1 = Math.max(0, cx - headW / 2)
  const hy1 = Math.max(0, cy - headH / 2)
  const hx2 = Math.min(sourceWidth, cx + headW / 2)
  const hy2 = Math.min(sourceHeight, cy + headH / 2)

  return {
    x1: hx1,
    y1: hy1,
    x2: hx2,
    y2: hy2,
    width: Math.max(1, hx2 - hx1),
    height: Math.max(1, hy2 - hy1),
    cx,
    cy,
    isStooped,
    aspectRatio,
  }
}
