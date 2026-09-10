import { useEffect, useState } from 'react'
import { Star, X } from 'lucide-react'
import { submitSessionRating } from '../api/measurement.js'

const LS_SESSION = 'trace.sessionId'
const LS_DONE = 'trace.sessionRating.done'

function getSessionId() {
  try {
    let id = localStorage.getItem(LS_SESSION)
    if (!id) {
      id = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      localStorage.setItem(LS_SESSION, id)
    }
    return id
  } catch {
    return 'session-unknown'
  }
}

export default function SessionRatingPrompt({ delayMs = 12000 }) {
  const [visible, setVisible] = useState(false)
  const [hovered, setHovered] = useState(0)
  const [selected, setSelected] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let done = false
    try {
      done = localStorage.getItem(LS_DONE) === '1'
    } catch {
      done = false
    }
    if (done) return

    const t = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(t)
  }, [delayMs])

  function close() {
    try {
      localStorage.setItem(LS_DONE, '1')
    } catch {
      /* ignore */
    }
    setVisible(false)
  }

  async function submit(rating) {
    setSelected(rating)
    setError(null)
    try {
      await submitSessionRating(rating, getSessionId())
      setSubmitted(true)
      try {
        localStorage.setItem(LS_DONE, '1')
      } catch {
        /* ignore */
      }
      setTimeout(() => setVisible(false), 2200)
    } catch (err) {
      setError(err.message || 'Could not record rating')
      setSelected(0)
    }
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 border border-line bg-surface p-4 shadow-lg">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-label font-medium text-ink-faint">session feedback</span>
          {submitted ? (
            <p className="mt-1 text-small text-ok">Thanks — rating recorded.</p>
          ) : (
            <p className="mt-1 text-caption text-ink-soft">
              How useful was this shift&apos;s monitoring?
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={close}
          className="text-ink-faint hover:text-ink"
          aria-label="Dismiss feedback"
        >
          <X size={14} />
        </button>
      </div>

      {!submitted && (
        <>
          <div className="mt-3 flex items-center gap-1" onMouseLeave={() => setHovered(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => submit(n)}
                onMouseEnter={() => setHovered(n)}
                className="text-ink-faint hover:text-signal"
                aria-label={`Rate ${n} out of 5`}
              >
                <Star
                  size={24}
                  className={n <= (hovered || selected) ? 'fill-signal text-signal' : ''}
                />
              </button>
            ))}
          </div>
          {error && <p className="mt-1 text-caption text-danger">{error}</p>}
        </>
      )}
    </div>
  )
}
