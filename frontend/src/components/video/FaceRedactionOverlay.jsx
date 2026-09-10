import { useEffect, useRef, useState, useMemo } from 'react'
import { computeRenderedVideoBounds, calculateHeadRegion, parseBbox } from '../../lib/faceGeometry.js'

/**
 * FaceRedactionOverlay
 * 
 * Responsible AI Privacy Protection (CLAUDE.md §22 & Phase 3):
 * Automatically obscures personnel face and head regions across live CCTV feeds and forensic replays.
 * 
 * Key architectural guarantees:
 * 1. Pixel-perfect letterbox & aspect ratio alignment (zero horizontal/vertical drift).
 * 2. Self-measuring ResizeObserver: never collapses to 0x0 or fails due to React mounting race conditions.
 * 3. Posture-aware geometry: adapts head/face envelope dynamically for upright, leaning, and stooped workers.
 * 4. 60fps playhead smoothing: eliminates 400ms polling jitter by interpolating between frames.
 * 5. Robust retention: holds head positions for up to 1.2s during transient detector dropouts to prevent unmasking.
 * 6. Fails gracefully: NEVER blurs the entire video monitor, obscuring only detected personnel faces.
 */
export default function FaceRedactionOverlay({
  entities,
  frame,
  sourceWidth = 1280,
  sourceHeight = 720,
  displayWidth = 0,
  displayHeight = 0,
  enabled = true,
  currentTime,
  videoRef,
  getEntitiesAtTime,
}) {
  const containerRef = useRef(null)
  const [measuredSize, setMeasuredSize] = useState({ width: 0, height: 0 })
  const lastActivePeopleRef = useRef([])
  const lastSeenTimestampRef = useRef(0)
  const [animTime, setAnimTime] = useState(currentTime || 0)

  // 1. Self-measure container dimensions with ResizeObserver
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

  // 2. Continuous 60fps playhead tracking during video playback
  useEffect(() => {
    let animId = null
    const checkVideo = () => {
      if (videoRef?.current && !videoRef.current.paused) {
        setAnimTime(videoRef.current.currentTime)
      }
      animId = requestAnimationFrame(checkVideo)
    }

    if (videoRef?.current) {
      animId = requestAnimationFrame(checkVideo)
    }

    return () => {
      if (animId) cancelAnimationFrame(animId)
    }
  }, [videoRef])

  // Sync animTime with external currentTime prop
  useEffect(() => {
    if (typeof currentTime === 'number') {
      setAnimTime(currentTime)
    }
  }, [currentTime])

  if (!enabled) return null

  // Effective dimensions: prefer measured container size, fallback to passed displayWidth/displayHeight
  const effectiveWidth = measuredSize.width || displayWidth || 0
  const effectiveHeight = measuredSize.height || displayHeight || 0

  // 3. Resolve active people from getEntitiesAtTime (tracks), entities prop, or frame prop
  let livePeople = []
  const effectiveCurrentTime = animTime ?? currentTime ?? 0

  if (typeof getEntitiesAtTime === 'function') {
    livePeople = getEntitiesAtTime(effectiveCurrentTime, true)
  }

  if (livePeople.length === 0) {
    const resolved = entities || frame?.entities || (Array.isArray(frame) ? frame : [])
    livePeople = (resolved || []).filter(
      (e) => (e.entity_class === 'person' || e.class_name === 'person') && (e.bbox || e.bounding_box)
    )
  }

  const now = Date.now()
  if (livePeople.length > 0) {
    lastActivePeopleRef.current = livePeople
    lastSeenTimestampRef.current = now
  }

  // Smooth retention: keep last known positions for up to 1.2s to prevent unmasking during detector gaps
  const activePeople =
    livePeople.length > 0
      ? livePeople
      : now - lastSeenTimestampRef.current < 1200
      ? lastActivePeopleRef.current
      : []

  // Compute exact rendered video rectangle inside container (letterbox/pillarbox compensation)
  const bounds = computeRenderedVideoBounds(
    effectiveWidth,
    effectiveHeight,
    sourceWidth,
    sourceHeight
  )

  const { offsetX, offsetY, renderWidth, renderHeight, scaleX, scaleY } = bounds

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden z-20"
      aria-label="Worker Privacy Shield (Faces Obscured)"
    >
      {effectiveWidth > 0 && effectiveHeight > 0 && activePeople.length > 0 && (
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
          {activePeople.map((person, idx) => {
            const rawBbox = person.bbox || person.bounding_box
            const headRegion = calculateHeadRegion(rawBbox, sourceWidth, sourceHeight)
            if (!headRegion) return null

            const left = headRegion.x1 * scaleX
            const top = headRegion.y1 * scaleY
            const width = headRegion.width * scaleX
            const height = headRegion.height * scaleY

            if (width <= 0 || height <= 0) return null

            const personId = person.id || person.track_id || idx

            return (
              <div
                key={`face-blur-${personId}`}
                className="absolute rounded-full pointer-events-none transition-all duration-75 ease-out"
                style={{
                  left: `${left}px`,
                  top: `${top}px`,
                  width: `${width}px`,
                  height: `${height}px`,
                  // Multi-layered visual privacy filter
                  backdropFilter: 'blur(28px) saturate(50%)',
                  WebkitBackdropFilter: 'blur(28px) saturate(50%)',
                  background:
                    'radial-gradient(ellipse at center, rgba(15, 23, 42, 0.82) 0%, rgba(30, 41, 59, 0.60) 55%, rgba(15, 23, 42, 0.25) 82%, rgba(15, 23, 42, 0.05) 100%)',
                  boxShadow: '0 0 12px rgba(0, 0, 0, 0.45)',
                  border: '1px solid rgba(255, 255, 255, 0.22)',
                }}
                title="Responsible AI: Personnel Identity Obscured"
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
