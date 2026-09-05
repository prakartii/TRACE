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
  // Identifies the (video, model) this hook currently wants data for.
  // A fetch started under an older key must never overwrite `data` once
  // the key has moved on — otherwise a slow request for the previous
  // model (e.g. a not-yet-cached 'pilot' pass) can resolve after a fast
  // one for the new model (e.g. an already-cached 'stock' pass) and
  // silently clobber it with stale-model results. This isn't
  // hypothetical: React StrictMode's double-invoked effects and rapid
  // toggling both make it easy to have two requests in flight for two
  // different keys at once. Also tracks which key currently has a fetch
  // in flight, so switching keys always starts a fresh request rather
  // than being silently dropped by an unrelated in-flight fetch.
  const currentKeyRef = useRef(null)
  const inFlightKeyRef = useRef(null)

  function fetchNow(timestamp) {
    const key = `${videoId}::${model}`
    if (inFlightKeyRef.current === key) return
    inFlightKeyRef.current = key
    setLoading(true)
    fetchFn(videoId, timestamp, model)
      .then((result) => {
        if (currentKeyRef.current !== key) return // superseded — discard
        setData(result)
        setError(null)
      })
      .catch((err) => {
        if (currentKeyRef.current !== key) return
        setError(err.message)
      })
      .finally(() => {
        if (inFlightKeyRef.current === key) inFlightKeyRef.current = null
        if (currentKeyRef.current === key) setLoading(false)
      })
  }

  function fetchThrottled(timestamp) {
    const now = performance.now()
    if (now - lastFetchAtRef.current < THROTTLE_MS) return
    lastFetchAtRef.current = now
    fetchNow(timestamp)
  }

  useEffect(() => {
    currentKeyRef.current = `${videoId}::${model}`
    if (!enabled || !videoId) {
      setData(null)
      setError(null)
      return
    }
    setData(null) // don't show the previous model's/video's results while loading
    fetchNow(currentTime)
    // Only re-run on toggle/video/model change — ongoing playback is
    // handled by the throttled fetch the caller drives from onTimeUpdate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, videoId, model])

  return { data, loading, error, fetchThrottled }
}
