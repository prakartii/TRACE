import { useEffect, useRef, useState } from 'react'
import {
  Send,
  Database,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  Eye,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  Video,
  ListFilter,
  Bot,
  User,
} from 'lucide-react'
import { askAssistant, getAssistantSuggestions } from '../api/assistant.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'

const CATEGORY_PROMPTS = [
  { label: '📋 Shift Briefing', query: 'Give me the shift briefing' },
  { label: '🚨 Active Interventions', query: 'What are the active interventions?' },
  { label: '⚠️ High Risks', query: 'Show high risk events' },
  { label: '🔍 Near Misses', query: 'Which bay had the most near misses?' },
  { label: '🛡️ Prevented Incidents', query: 'How many events were prevented?' },
  { label: '📦 Overhang Protocol', query: 'What is the protocol for box overhang?' },
  { label: '📐 Stability Formula', query: 'How does the planner calculate stability?' },
  { label: '🏷️ Catalog Rules', query: 'What product rules are configured?' },
]

export default function AiAssistant() {
  const { navigateTo } = useLiveViewContext()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState([])
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
    setMessages((m) => [...m, { role: 'user', text: q, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }])
    setLoading(true)
    try {
      const res = await askAssistant(q)
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          ...res,
        },
      ])
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          error: err.message || 'Request failed',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleClear() {
    setMessages([])
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      {/* Top Header */}
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink text-paper">
              <Bot size={15} />
            </span>
            <h1 className="font-display text-display font-semibold text-ink">Safety Assistant</h1>
            <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
              Live
            </span>
          </div>
          <p className="mt-1 text-small text-ink-soft">
            Ask about warehouse safety alerts, high-risk areas, or safe handling guidelines.
          </p>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 text-caption font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            <RotateCcw size={13} />
            clear chat
          </button>
        )}
      </section>

      {/* Quick Intent Pills */}
      <section className="flex items-center gap-2 overflow-x-auto pb-1 text-caption">
        <span className="inline-flex items-center gap-1 text-ink-faint">
          <ListFilter size={13} />
          quick questions:
        </span>
        {CATEGORY_PROMPTS.map((cp) => (
          <button
            key={cp.label}
            type="button"
            onClick={() => send(cp.query)}
            disabled={loading}
            className="shrink-0 border border-line bg-surface px-2.5 py-1 font-medium text-ink-soft transition-all hover:border-ink hover:bg-paper hover:text-ink disabled:opacity-50"
          >
            {cp.label}
          </button>
        ))}
      </section>

      {/* Chat Container - Fixed Height & Scrollable */}
      <section className="flex h-[620px] max-h-[75vh] flex-col border border-line bg-surface shadow-sm">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 scroll-smooth">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-paper text-ink">
                <Sparkles size={22} className="text-accent" />
              </div>
              <h2 className="text-small font-semibold text-ink">How can I assist your safety inspection today?</h2>
              <p className="mt-1 max-w-md text-caption text-ink-soft">
                Ask about today's shift briefing, active alerts, near misses, or safe box stacking.
              </p>

              <div className="mt-6 grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2 text-left">
                {suggestions.slice(0, 6).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="flex items-center justify-between border border-line bg-paper p-2.5 text-small text-ink-soft transition-all hover:border-ink hover:text-ink hover:shadow-xs"
                  >
                    <span>{s}</span>
                    <ArrowRight size={13} className="shrink-0 ml-2 text-ink-faint" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end gap-2">
                <div className="max-w-[78%] border border-ink/10 bg-ink p-3 text-small text-paper shadow-xs">
                  <div className="flex items-center justify-between gap-3 pb-1 text-caption text-paper/60 border-b border-paper/10 mb-1.5">
                    <span className="font-semibold uppercase tracking-wider text-[10px]">Supervisor</span>
                    <span>{m.time}</span>
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap">{m.text}</p>
                </div>
              </div>
            ) : (
              <AssistantBubble key={i} msg={m} onFollowUp={(text) => send(text)} navigateTo={navigateTo} />
            ),
          )}

          {loading && (
            <div className="flex items-center gap-2.5 border border-line bg-paper px-4 py-3 text-caption text-ink-soft">
              <span className="h-3.5 w-3.5 animate-spin border-2 border-ink border-t-transparent" />
              <span>Querying TRACE audit engine and computing safety synthesis…</span>
            </div>
          )}
        </div>

        {/* Dynamic Suggestions Bar if messages exist */}
        {messages.length > 0 && suggestions.length > 0 && !loading && (
          <div className="flex items-center gap-2 overflow-x-auto border-t border-line bg-surface/50 px-4 py-2">
            <span className="text-caption text-ink-faint shrink-0">suggested:</span>
            {suggestions.slice(0, 3).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="shrink-0 border border-line bg-paper px-2 py-0.5 text-caption text-ink-soft hover:border-ink hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
          className="flex items-center gap-2 border-t border-line bg-paper p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about events, bays, protocols, near misses, or stability…"
            className="flex-1 border border-line bg-surface px-3.5 py-2.5 text-small text-ink focus:border-ink focus:outline-none placeholder:text-ink-faint"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2.5 text-small font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
          >
            <Send size={14} />
            <span>Ask</span>
          </button>
        </form>
      </section>
    </div>
  )
}

function AssistantBubble({ msg, onFollowUp, navigateTo }) {
  const [showGrounding, setShowGrounding] = useState(false)

  if (msg.error) {
    return (
      <div className="flex items-start gap-2.5 border border-danger/30 bg-danger/5 p-4 text-small text-danger">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold text-caption uppercase tracking-wider">Assistant Query Error</div>
          <p className="mt-0.5">{msg.error}</p>
        </div>
      </div>
    )
  }

  const rows = msg.grounded_row_count ?? 0
  const grounding = msg.grounding || []
  const cards = msg.cards || []
  const metrics = msg.metrics || []
  const followups = msg.suggested_followups?.length ? msg.suggested_followups : (msg.suggestions || [])

  return (
    <div className="flex flex-col gap-3 max-w-[90%]">
      {/* Main Response Box */}
      <div className="border border-line bg-paper p-4 shadow-xs">
        {/* Header metadata */}
        <div className="flex items-center justify-between border-b border-line pb-2 mb-3 text-caption text-ink-faint">
          <div className="flex items-center gap-1.5 font-medium text-ink">
            <span className="flex h-4 w-4 items-center justify-center rounded-xs bg-ink text-paper">
              <Bot size={11} />
            </span>
            <span>TRACE Intelligence</span>
            {msg.used_llm && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-accent text-[11px]">
                <Sparkles size={10} />
                Claude {msg.model || '3.5'}
              </span>
            )}
          </div>
          <span>{msg.time}</span>
        </div>

        {/* Render Formatted Text */}
        <div className="text-small leading-relaxed text-ink space-y-2">
          {renderFormattedAnswer(msg.answer)}
        </div>

        {/* Render Metrics Grid if present */}
        {metrics.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 border-t border-line pt-3">
            {metrics.map((met, idx) => (
              <div key={idx} className="border border-line bg-surface p-2.5">
                <div className="text-caption text-ink-faint">{met.label}</div>
                <div className="mt-0.5 text-display font-semibold text-ink">{met.value}</div>
                {met.subtext && <div className="mt-0.5 text-[11px] text-ink-soft">{met.subtext}</div>}
              </div>
            ))}
          </div>
        )}

        {/* Render Interactive Event Cards if present */}
        {cards.length > 0 && (
          <div className="mt-4 space-y-2.5 border-t border-line pt-3">
            <div className="text-caption font-semibold uppercase tracking-wider text-ink-soft">
              Related Event Records ({cards.length})
            </div>
            <div className="grid grid-cols-1 gap-2.5">
              {cards.map((card) => (
                <EventCard key={card.event_id} card={card} navigateTo={navigateTo} />
              ))}
            </div>
          </div>
        )}

        {/* Grounding / Audit Footer */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-caption text-ink-faint">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 font-mono text-[11px]">
              <Database size={11} />
              {rows} record{rows === 1 ? '' : 's'} verified
            </span>
            <span>·</span>
            <span>{msg.used_llm ? 'Synthesized via LLM' : 'Deterministic database output'}</span>
          </div>

          {grounding.length > 0 && (
            <button
              type="button"
              onClick={() => setShowGrounding((v) => !v)}
              className="font-medium underline hover:text-ink text-ink-soft"
            >
              {showGrounding ? 'Hide audit trace' : 'View audit trace'}
            </button>
          )}
        </div>

        {/* Collapsible Grounding Source Details */}
        {showGrounding && (
          <div className="mt-3 space-y-2 border-t border-line-strong bg-surface p-3 text-caption">
            <div className="font-semibold text-ink">Deterministic Grounding Records:</div>
            {grounding.map((g, i) => (
              <div key={i} className="font-mono text-ink-soft text-[11px] border-b border-line pb-1.5 last:border-0 last:pb-0">
                <span className="font-semibold text-ink">{g.query}</span> — {g.source} ({g.row_count} row{g.row_count === 1 ? '' : 's'})
                {g.event_ids?.length > 0 && (
                  <div className="text-ink-faint mt-0.5">
                    matched event IDs: {g.event_ids.join(', ')}
                  </div>
                )}
              </div>
            ))}
            {msg.used_llm && msg.deterministic_answer && msg.deterministic_answer !== msg.answer && (
              <div className="mt-2 border-l-2 border-line-strong pl-2 text-ink-faint text-[11px]">
                <span className="font-medium text-ink-soft">Raw deterministic template:</span>{' '}
                {msg.deterministic_answer}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Suggested Follow-Up Chips */}
      {followups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pl-1">
          <span className="text-[11px] font-medium text-ink-faint">Follow up:</span>
          {followups.map((f, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onFollowUp(f)}
              className="inline-flex items-center gap-1 border border-line bg-surface px-2.5 py-1 text-caption text-ink hover:border-ink hover:bg-paper transition-all"
            >
              <span>{f}</span>
              <ArrowRight size={11} className="text-ink-faint" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EventCard({ card, navigateTo }) {
  const severityColors = {
    critical: 'bg-danger/10 text-danger border-danger/30',
    high: 'bg-warn/15 text-warn border-warn/30',
    medium: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    low: 'bg-ok/10 text-ok border-ok/30',
  }
  const sevStyle = severityColors[card.severity?.toLowerCase()] || severityColors.medium

  return (
    <div className="border border-line bg-surface p-3 transition-colors hover:border-line-strong">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-caption font-bold text-ink">#{card.event_id}</span>
          <span className={`border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${sevStyle}`}>
            {card.severity}
          </span>
          <span className="text-caption font-semibold text-ink">{card.scenario_title}</span>
        </div>
        <div className="flex items-center gap-2 text-caption text-ink-faint">
          <span className="inline-flex items-center gap-1">
            <Video size={11} />
            {card.camera_name || card.camera_id}
          </span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <Clock size={11} />
            {card.timestamp_formatted || `${card.timestamp}s`}
          </span>
        </div>
      </div>

      {card.recommendation && (
        <div className="mt-2 text-small text-ink-soft flex items-start gap-1.5">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-ink" />
          <span>{card.recommendation}</span>
        </div>
      )}

      {card.evidence && (
        <div className="mt-1 font-mono text-[11px] text-ink-faint">
          Evidence: {typeof card.evidence === 'object' ? JSON.stringify(card.evidence) : card.evidence}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-line/60 pt-2 text-caption">
        <button
          type="button"
          onClick={() =>
            navigateTo('Incident Replay', {
              eventId: card.event_id,
              videoId: card.camera_id,
              timestamp: card.timestamp,
            })
          }
          className="inline-flex items-center gap-1 border border-line bg-paper px-2.5 py-1 font-medium text-ink hover:border-ink transition-colors"
        >
          <RotateCcw size={12} />
          Inspect Replay →
        </button>
        <button
          type="button"
          onClick={() =>
            navigateTo('Live View', {
              videoId: card.camera_id,
              timestamp: card.timestamp,
            })
          }
          className="inline-flex items-center gap-1 border border-line bg-paper px-2.5 py-1 font-medium text-ink hover:border-ink transition-colors"
        >
          <Eye size={12} />
          Live Camera →
        </button>
      </div>
    </div>
  )
}

function renderFormattedAnswer(text) {
  if (!text) return null
  const lines = text.split('\n')
  return lines.map((line, idx) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return <div key={idx} className="h-1.5" />
    }
    // Check if line is a bullet
    if (trimmed.startsWith('•') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.replace(/^[•\-*]\s*/, '')
      return (
        <div key={idx} className="flex items-start gap-2 pl-2">
          <span className="text-ink font-bold leading-relaxed">•</span>
          <span>{formatInline(content)}</span>
        </div>
      )
    }
    return <p key={idx}>{formatInline(trimmed)}</p>
  })
}

function formatInline(str) {
  // Simple regex parser for **bold** text and `code` tags
  const parts = []
  let remaining = str
  let key = 0

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.*?)\*\*/)
    const codeMatch = remaining.match(/`(.*?)`/)

    let match = null
    let type = null

    if (boldMatch && (!codeMatch || boldMatch.index < codeMatch.index)) {
      match = boldMatch
      type = 'bold'
    } else if (codeMatch) {
      match = codeMatch
      type = 'code'
    }

    if (!match) {
      parts.push(remaining)
      break
    }

    if (match.index > 0) {
      parts.push(remaining.substring(0, match.index))
    }

    if (type === 'bold') {
      parts.push(
        <strong key={key++} className="font-semibold text-ink">
          {match[1]}
        </strong>
      )
    } else if (type === 'code') {
      parts.push(
        <code key={key++} className="rounded bg-line/60 px-1 py-0.5 font-mono text-[11px] text-ink">
          {match[1]}
        </code>
      )
    }

    remaining = remaining.substring(match.index + match[0].length)
  }

  return parts
}

