import { useEffect, useRef, useState } from 'react'

// Not wired to a live endpoint yet: the backend exposes no /ws/live route
// until the intervention layer (Phase 9) is built. This is the connection
// primitive later screens (Live View, Planner) will consume.
export function useWebSocket(url, { enabled = true } = {}) {
  const [status, setStatus] = useState('idle')
  const [lastMessage, setLastMessage] = useState(null)
  const socketRef = useRef(null)

  useEffect(() => {
    if (!enabled || !url) return undefined

    setStatus('connecting')
    const socket = new WebSocket(url)
    socketRef.current = socket

    socket.onopen = () => setStatus('open')
    socket.onclose = () => setStatus('closed')
    socket.onerror = () => setStatus('error')
    socket.onmessage = (event) => {
      try {
        setLastMessage(JSON.parse(event.data))
      } catch {
        setLastMessage(event.data)
      }
    }

    return () => socket.close()
  }, [url, enabled])

  const send = (data) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(typeof data === 'string' ? data : JSON.stringify(data))
    }
  }

  return { status, lastMessage, send }
}
