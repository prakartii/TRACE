import { useState } from 'react'
import { submitReview } from '../../api/events.js'

// Human-review gate (CLAUDE.md §22). "Confirmed damage" is only ever set here,
// by a person — TRACE never self-confirms.
const ACTIONS = [
  ['unresolved', 'mark reviewed'],
  ['false_positive', 'false positive'],
  ['confirmed_damage', 'confirm damage'],
]

export default function ReviewActions({ eventId, current, onReviewed }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  async function run(status) {
    if (!eventId || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const updated = await submitReview(eventId, status)
      setMessage(`recorded: ${status.replace(/_/g, ' ')}`)
      onReviewed?.(updated)
    } catch (err) {
      setMessage(err.message || 'review failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <span className="eyebrow mb-2 block">Review</span>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map(([status, label]) => (
          <button
            key={status}
            type="button"
            disabled={busy}
            onClick={() => run(status)}
            className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-caption text-dim hover:text-ink disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-label text-mute">
        {message ||
          (current && current !== 'unresolved'
            ? `current: ${current.replace(/_/g, ' ')}`
            : '“Confirmed damage” is only ever set here, by a person.')}
      </p>
    </div>
  )
}
