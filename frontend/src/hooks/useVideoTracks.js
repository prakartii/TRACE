import { useEffect, useRef, useState, useCallback } from 'react'
import { getTracks } from '../api/videos.js'
import { parseBbox, lerpBbox } from '../lib/faceGeometry.js'

// In-memory module cache for video tracks across component mounts
const tracksCache = new Map()

/**
 * Binary search to find index of the frame immediately at or before `timestamp`.
 */
function findFrameIndex(frames, timestamp) {
  if (!frames || frames.length === 0) return -1
  let low = 0
  let high = frames.length - 1

  if (timestamp <= frames[0].timestamp) return 0
  if (timestamp >= frames[high].timestamp) return high

  while (low <= high) {
    const mid = (low + high) >> 1
    if (frames[mid].timestamp <= timestamp) {
      if (mid === frames.length - 1 || frames[mid + 1].timestamp > timestamp) {
        return mid
      }
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return low
}

/**
 * Hook to retrieve and interpolate video tracks across playback time.
 * Provides 60fps continuous personnel bounding box positions without network latency.
 */
export function useVideoTracks(videoId, model = 'pilot') {
  const [tracks, setTracks] = useState(() => {
    const key = `${videoId}::${model}`
    return tracksCache.get(key) || null
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const activeVideoKeyRef = useRef(`${videoId}::${model}`)

  useEffect(() => {
    const key = `${videoId}::${model}`
    activeVideoKeyRef.current = key

    if (!videoId) {
      setTracks(null)
      setError(null)
      setLoading(false)
      return
    }

    if (tracksCache.has(key)) {
      setTracks(tracksCache.get(key))
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    getTracks(videoId, model)
      .then((data) => {
        if (cancelled || activeVideoKeyRef.current !== key) return
        const frameList = Array.isArray(data) ? data : (data?.frames || [])
        // Ensure sorted by timestamp
        frameList.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        tracksCache.set(key, frameList)
        setTracks(frameList)
      })
      .catch((err) => {
        if (cancelled || activeVideoKeyRef.current !== key) return
        setError(err.message || 'Failed to load video tracks')
        setTracks(null)
      })
      .finally(() => {
        if (!cancelled && activeVideoKeyRef.current === key) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [videoId, model])

  /**
   * Fast, frame-interpolated query for personnel entities at exact `currentTime`.
   */
  const getEntitiesAtTime = useCallback(
    (currentTime, onlyPerson = true) => {
      if (!tracks || tracks.length === 0) return []

      const idx = findFrameIndex(tracks, currentTime)
      if (idx < 0) return []

      const f0 = tracks[idx]
      const f1 = idx + 1 < tracks.length ? tracks[idx + 1] : null

      const filterClass = (ent) => {
        if (!onlyPerson) return true
        const c = ent.entity_class || ent.class_name
        return c === 'person'
      }

      const e0List = (f0?.entities || []).filter(filterClass)

      // If no next frame or frame delta too wide (>0.6s), return nearest frame
      if (!f1 || (f1.timestamp - f0.timestamp > 0.6) || (f1.timestamp <= f0.timestamp)) {
        return e0List
      }

      const e1List = (f1.entities || []).filter(filterClass)
      const alpha = Math.max(0, Math.min(1, (currentTime - f0.timestamp) / (f1.timestamp - f0.timestamp)))

      const interpolated = []
      const matchedE1Ids = new Set()

      for (const ent0 of e0List) {
        const box0 = parseBbox(ent0.bbox || ent0.bounding_box)
        if (!box0) continue

        // Match by track_id, or by id fallback
        const trackId0 = ent0.track_id || ent0.id
        const ent1 = e1List.find((e) => (e.track_id || e.id) === trackId0)

        if (ent1) {
          matchedE1Ids.add(ent1.track_id || ent1.id)
          const box1 = parseBbox(ent1.bbox || ent1.bounding_box)
          if (box1) {
            interpolated.push({
              ...ent0,
              bbox: lerpBbox(box0, box1, alpha),
              interpolated: true,
              confidence: (ent0.confidence || 0.8) * (1 - alpha) + (ent1.confidence || 0.8) * alpha,
            })
            continue
          }
        }

        // Entity present in f0 but missing in f1
        if (alpha < 0.65) {
          interpolated.push(ent0)
        }
      }

      // Add new entities appearing in f1
      for (const ent1 of e1List) {
        const id1 = ent1.track_id || ent1.id
        if (!matchedE1Ids.has(id1) && alpha >= 0.35) {
          interpolated.push(ent1)
        }
      }

      return interpolated
    },
    [tracks]
  )

  return {
    tracks,
    loading,
    error,
    getEntitiesAtTime,
  }
}
