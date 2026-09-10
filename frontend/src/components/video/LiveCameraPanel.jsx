import { useEffect, useRef, useState } from 'react'
import { Radio } from 'lucide-react'
import { listLiveSources, liveStreamWsUrl } from '../../api/live.js'

export default function LiveCameraPanel() {
  const [sources, setSources] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [frameUrl, setFrameUrl] = useState(null)
  const [status, setStatus] = useState('idle') // idle | connecting | live | error
  const [error, setError] = useState(null)
  const wsRef = useRef(null)

  useEffect(() => {
    listLiveSources()
      .then((list) => {
        setSources(list)
        setSelectedId((cur) => cur ?? list[0]?.id ?? null)
      })
      .catch(() => setSources([]))
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setStatus('connecting')
    setError(null)
    let closed = false
    const ws = new WebSocket(liveStreamWsUrl(selectedId))
    ws.binaryType = 'blob'
    wsRef.current = ws

    ws.onopen = () => !closed && setStatus('live')
    ws.onmessage = (ev) => {
      if (closed) return
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.error) {
            setStatus('error')
            setError(msg.error)
          }
        } catch {
          /* ignore */
        }
        return
      }
      const url = URL.createObjectURL(ev.data)
      setFrameUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    }
    ws.onerror = () => !closed && setStatus('error')
    ws.onclose = () => !closed && setStatus('idle')

    return () => {
      closed = true
      ws.close()
    }
  }, [selectedId])

  if (sources.length === 0) return null

  return (
    <div className="mt-3 border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Radio size={13} className="text-ink-soft" />
        <span className="text-small font-semibold text-ink">Live cameras</span>
        {status === 'live' && (
          <span className="ml-auto flex items-center gap-1 text-caption text-ok">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            live
          </span>
        )}
      </div>

      {sources.length > 1 && (
        <div className="flex gap-1 px-3 pt-2">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              className={`px-2 py-0.5 text-caption font-medium ${
                selectedId === s.id
                  ? 'bg-ink text-paper'
                  : 'border border-line text-ink-soft hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="p-3">
        <div className="flex aspect-video items-center justify-center overflow-hidden border border-line bg-ink">
          {frameUrl ? (
            <img src={frameUrl} alt="live feed" className="h-full w-full object-contain" />
          ) : (
            <span className="px-3 text-center text-caption text-paper/50">
              {status === 'connecting' ? 'connecting…' : error || 'no signal'}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-caption text-ink-faint">
          RTSP/HLS feed streamed over WebSocket — configure via TRACE_LIVE_SOURCES.
        </p>
      </div>
    </div>
  )
}
