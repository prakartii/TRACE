import { useEffect, useRef, useState } from 'react'
import { askAssistant, getAssistantSuggestions } from '../api/assistant.js'

const FALLBACK_SUGGESTIONS = [
  'What were the most common risks?',
  'How many events were prevented?',
  'Which source had the most near misses?',
  'Why was event #73 risky?',
  'Which behaviour occurred most frequently?',
]

export default function Assistant() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState(FALLBACK_SUGGESTIONS)
  const [meta, setMeta] = useState(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    getAssistantSuggestions()
      .then((d) => {
        if (d.suggestions?.length) setSuggestions(d.suggestions)
        setMeta(d)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  async function send(text) {
    const q = (text ?? input).trim()
    if (!q || loading) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: q }])
    setLoading(true)
    try {
      const res = await askAssistant(q)
      setMessages((m) => [...m, { role: 'assistant', ...res }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', error: err.message || 'Request failed' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-page font-semibold">Assistant</h1>

      <p className="max-w-prose text-caption text-dim">
        Grounded in the event store. Answers are retrieval-only
        {meta &&
          (meta.llm_available
            ? ` — Claude (${meta.model}) rephrases the same rows.`
            : ' unless an ANTHROPIC_API_KEY is set; there is none, so answers are the retrieval layer verbatim.')}
      </p>

      <div className="flex min-h-[52vh] flex-col rounded-md border border-line">
        <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="text-caption text-mute">
              Ask about logged risks, prevented events, near misses, why a specific event was
              flagged, or what TRACE recommended.
            </p>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="self-end">
                <div className="max-w-[80%] rounded-md bg-ink px-3 py-1.5 text-body text-bg">{m.text}</div>
              </div>
            ) : (
              <AssistantAnswer key={i} msg={m} />
            ),
          )}
          {loading && <p className="text-caption text-mute">retrieving from the event store…</p>}
        </div>

        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2 border-t border-line p-3">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded border border-line-strong bg-bg px-2.5 py-1 text-caption text-dim hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
          className="flex items-center gap-2 border-t border-line p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question…"
            className="flex-1 rounded border border-line-strong bg-bg px-3 py-2 text-body text-ink focus:border-ink focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-md border border-ink bg-ink px-4 py-2 text-caption font-semibold text-bg disabled:opacity-50"
          >
            send
          </button>
        </form>
      </div>
    </div>
  )
}

function AssistantAnswer({ msg }) {
  const [showSources, setShowSources] = useState(false)

  if (msg.error) {
    return (
      <p className="font-mono text-caption text-crit">[assistant error] {msg.error}</p>
    )
  }

  const rows = msg.grounded_row_count ?? 0
  const grounding = msg.grounding || []

  return (
    <div className="max-w-[85%] border-l-2 border-line-strong pl-3">
      <p className="text-body">{msg.answer}</p>

      <p className="mt-1.5 font-mono text-label text-mute">
        based on {rows} record{rows === 1 ? '' : 's'} ·{' '}
        {msg.used_llm ? 'phrased by Claude' : 'retrieval verbatim'}
        {grounding.length > 0 && (
          <>
            {' · '}
            <button type="button" onClick={() => setShowSources((v) => !v)} className="underline hover:text-ink">
              {showSources ? 'hide' : 'show'} sources
            </button>
          </>
        )}
      </p>

      {showSources && (
        <div className="mt-1.5 flex flex-col gap-1 border-t border-line pt-1.5 font-mono text-label text-dim">
          {grounding.map((g, i) => (
            <div key={i}>
              <span className="text-ink">{g.query}</span> — {g.source} ({g.row_count} row
              {g.row_count === 1 ? '' : 's'})
              {g.event_ids?.length > 0 && (
                <span className="text-mute">
                  {' '}· events {g.event_ids.slice(0, 12).join(', ')}
                  {g.event_ids.length > 12 ? '…' : ''}
                </span>
              )}
            </div>
          ))}
          {msg.used_llm && msg.deterministic_answer && msg.deterministic_answer !== msg.answer && (
            <div className="border-l-2 border-line-strong pl-2 text-mute">
              retrieval layer said: {msg.deterministic_answer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
