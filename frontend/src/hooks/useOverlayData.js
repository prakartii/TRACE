import { useEffect, useRef, useState } from 'react'

const THROTTLE_MS = 400

// Shared polling pattern behind LiveView's optional overlays (perception
// entities, scene graph): fetch once when enabled/video/model changes,
// then re-fetch (throttled) as playback time advances. Both overlays hit
// endpoints that cache a whole video's perception pass server-side per
// (model, video) pair on first call.
export function useOverlayData(fetchFn, enabled, videoId, currentTime, model = 'stock') {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const lastFetchAtRef = useRef(0)
  const currentKeyRef = useRef(null)
  const inFlightKeyRef = useRef(null)
  const requestIdRef = useRef(0)

  function fetchNow(timestamp, force = false) {
    const key = `${videoId}::${model}`
    if (!force && inFlightKeyRef.current === key) return
    inFlightKeyRef.current = key
    const reqId = ++requestIdRef.current
    setLoading(true)

    fetchFn(videoId, timestamp, model)
      .then((result) => {
        if (currentKeyRef.current !== key || requestIdRef.current !== reqId) return
        setData(result)
        setError(null)
      })
      .catch((err) => {
        if (currentKeyRef.current !== key || requestIdRef.current !== reqId) return
        setError(err.message)
      })
      .finally(() => {
        if (requestIdRef.current === reqId) {
          inFlightKeyRef.current = null
          setLoading(false)
        }
      })
  }

  function fetchImmediate(timestamp) {
    lastFetchAtRef.current = performance.now()
    fetchNow(timestamp, true)
  }

  function fetchThrottled(timestamp) {
    const now = performance.now()
    if (now - lastFetchAtRef.current < THROTTLE_MS) return
    lastFetchAtRef.current = now
    fetchNow(timestamp, false)
  }

  useEffect(() => {
    currentKeyRef.current = `${videoId}::${model}`
    if (!enabled || !videoId) {
      setData(null)
      setError(null)
      return
    }
    setData(null) // don't show the previous model's/video's results while loading
    fetchNow(currentTime, true)
    // Only re-run on toggle/video/model change — ongoing playback is
    // handled by the throttled fetch the caller drives from onTimeUpdate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, videoId, model])

  return { data, loading, error, fetchThrottled, fetchImmediate }
}
