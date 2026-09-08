import { useEffect, useRef, useState } from 'react'
import { Send, Database, Sparkles } from 'lucide-react'
import { askAssistant, getAssistantSuggestions } from '../api/assistant.js'

const FALLBACK_SUGGESTIONS = [
  'What were the most common risks?',
  'How many events were prevented?',
  'Which source had the most near misses?',
  'Why was event #73 risky?',
  'What did TRACE recommend for event #73?',
  'Which behaviour occurred most frequently?',
]

export default function AiAssistant() {
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
    <div className="flex flex-col gap-6 pb-4">
      <section>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-display-lg font-semibold text-ink">Supervisor assistant</h1>
          <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-medium uppercase tracking-wider text-ok">
            grounded
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-body text-ink-soft">
          Every answer is retrieved from the TRACE event database and shows the records it used.
          {meta && (
            <span className="ml-1 text-ink-faint">
              {meta.llm_available
                ? `Claude (${meta.model}) rephrases the retrieved rows.`
                : 'No language model is configured — answers are the retrieval layer verbatim.'}
            </span>
          )}
        </p>
      </section>

      <section className="flex min-h-[52vh] flex-col border border-line bg-surface">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="text-small text-ink-faint">
              Ask about logged risks, prevented events, near misses, why a specific event was
              flagged, or what TRACE recommended.
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] bg-ink px-3.5 py-2 text-small text-paper">{m.text}</div>
              </div>
            ) : (
              <AssistantBubble key={i} msg={m} />
            ),
          )}
          {loading && (
            <div className="flex items-center gap-2 text-caption text-ink-faint">
              <span className="h-3 w-3 animate-spin motion-reduce:animate-none border-2 border-ink-faint border-t-transparent" />
              retrieving from the event store…
            </div>
          )}
        </div>

        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2 border-t border-line p-3">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="border border-line bg-paper px-2.5 py-1 text-caption text-ink-soft transition-colors hover:border-ink hover:text-ink"
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
            placeholder="Ask a question about the operation…"
            className="flex-1 border border-line bg-paper px-3 py-2 text-small text-ink focus:border-ink focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-1.5 border border-ink bg-ink px-3.5 py-2 text-small font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
          >
            <Send size={14} />
            ask
          </button>
        </form>
      </section>
    </div>
  )
}

function AssistantBubble({ msg }) {
  const [showGrounding, setShowGrounding] = useState(false)
  if (msg.error) {
    return (
      <div className="border border-danger bg-danger/5 p-3 font-mono text-caption text-danger">
        [assistant error] {msg.error}
      </div>
    )
  }
  const rows = msg.grounded_row_count ?? 0
  const grounding = msg.grounding || []
  return (
    <div className="max-w-[85%] border border-line bg-paper p-3.5">
      <p className="text-small leading-relaxed text-ink">{msg.answer}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-caption text-ink-faint">
        <span className="inline-flex items-center gap-1">
          <Database size={11} />
          based on {rows} record{rows === 1 ? '' : 's'}
        </span>
        <span>·</span>
        <span className="inline-flex items-center gap-1">
          {msg.used_llm ? <Sparkles size={11} /> : null}
          {msg.used_llm ? 'phrased by Claude' : 'retrieval verbatim'}
        </span>
        {grounding.length > 0 && (
          <>
            <span>·</span>
            <button
              type="button"
              onClick={() => setShowGrounding((v) => !v)}
              className="underline hover:text-ink"
            >
              {showGrounding ? 'hide' : 'show'} sources
            </button>
          </>
        )}
      </div>

      {showGrounding && (
        <div className="mt-2 space-y-1.5 border-t border-line pt-2">
          {grounding.map((g, i) => (
            <div key={i} className="font-mono text-caption text-ink-soft">
              <span className="text-ink">{g.query}</span> — {g.source} ({g.row_count} row
              {g.row_count === 1 ? '' : 's'})
              {g.event_ids?.length > 0 && (
                <span className="text-ink-faint">
                  {' '}· events {g.event_ids.slice(0, 12).join(', ')}
                  {g.event_ids.length > 12 ? '…' : ''}
                </span>
              )}
            </div>
          ))}
          {msg.used_llm && msg.deterministic_answer && msg.deterministic_answer !== msg.answer && (
            <div className="mt-1 border-l-2 border-line-strong pl-2 text-caption text-ink-faint">
              retrieval layer said: {msg.deterministic_answer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
