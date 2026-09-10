import { useEffect, useRef, useState } from 'react'
import {
  Send,
  Database,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  Eye,
  RotateCcw,
  AlertTriangle,
  Info,
  Clock,
  Video,
  ListFilter,
  Bot,
  ChevronDown,
} from 'lucide-react'
import { askAssistant, getAssistantSuggestions } from '../api/assistant.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'

const CATEGORY_PROMPTS = [
  { label: '⚠️ Highest-Risk Events', query: 'What are the highest-risk events?' },
  { label: '🔄 Unsafe Behaviour', query: 'What unsafe behaviour occurred most often?' },
  { label: '❓ Why High Risk?', query: 'Why was this incident high risk?' },
  { label: '⚡ Next Action', query: 'What should the supervisor do next?' },
  { label: '📹 Video Findings', query: 'What did TRACE find in this video?' },
  { label: '📋 Shift Briefing', query: 'Give me the shift briefing' },
  { label: '🚨 Active Alerts', query: 'Are there any active alerts?' },
]

export default function AiAssistant() {
  const { navigateTo, liveState } = useLiveViewContext()
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
      const res = await askAssistant(q, liveState?.selectedId ?? null)
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
    <div className="flex flex-col gap-3 pb-2">
      {/* Top Header */}
      <section className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink text-paper">
              <Bot size={15} />
            </span>
            <h1 className="text-xl font-bold text-ink">Supervisor AI Assistant</h1>
            <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-bold text-ok">
              Live Grounded Agent
            </span>
          </div>
          <p className="mt-1 text-small text-ink-soft">
            Natural language safety intelligence grounded strictly in verified camera detections, shift reports, and deterministic physics rules.
          </p>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 text-caption font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink cursor-pointer"
          >
            <RotateCcw size={13} />
            Clear Chat
          </button>
        )}
      </section>

      {/* Quick Intent Pills */}
      <section className="flex items-center gap-1.5 overflow-x-auto pb-1 text-caption">
        <span className="inline-flex items-center gap-1 font-bold text-ink-faint shrink-0 uppercase text-[10px]">
          <ListFilter size={12} />
          Quick Questions:
        </span>
        {CATEGORY_PROMPTS.map((cp) => (
          <button
            key={cp.label}
            type="button"
            onClick={() => send(cp.query)}
            disabled={loading}
            className="shrink-0 border border-line bg-surface px-2.5 py-1 text-caption font-semibold text-ink-soft transition-all hover:border-ink hover:bg-paper hover:text-ink disabled:opacity-50 cursor-pointer"
          >
            {cp.label}
          </button>
        ))}
      </section>

      {/* Chat Container - Spacious & Scrollable */}
      <section className="flex h-[620px] max-h-[75vh] flex-col border border-line bg-surface shadow-sm">
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3 scroll-smooth">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper text-ink">
                <Sparkles size={18} className="text-accent" />
              </div>
              <h2 className="text-small font-semibold text-ink">How can I assist your safety inspection today?</h2>
              <p className="mt-0.5 max-w-md text-caption text-ink-soft">
                Ask about high-risk events, unsafe behaviours, root cause explanations, or recommended actions:
              </p>

              <div className="mt-4 grid max-w-2xl grid-cols-1 gap-1.5 sm:grid-cols-2 text-left">
                {(suggestions.length > 0 ? suggestions : [
                  'What are the highest-risk events?',
                  'What unsafe behaviour occurred most often?',
                  'Why was this incident high risk?',
                  'What should the supervisor do next?',
                  'What did TRACE find in this video?',
                  'Give me a shift safety briefing',
                ]).slice(0, 6).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="flex items-center justify-between border border-line bg-paper p-2 text-caption text-ink-soft transition-all hover:border-ink hover:text-ink hover:shadow-xs cursor-pointer"
                  >
                    <span>{s}</span>
                    <ArrowRight size={12} className="shrink-0 ml-2 text-ink-faint" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end gap-2">
                <div className="max-w-[78%] border border-ink/10 bg-ink p-2.5 text-small text-paper shadow-xs">
                  <div className="flex items-center justify-between gap-3 pb-1 text-caption text-paper/60 border-b border-paper/10 mb-1">
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
            <div className="flex items-center gap-2 border border-line bg-paper px-3 py-2 text-caption text-ink-soft">
              <span className="h-3.5 w-3.5 animate-spin border-2 border-ink border-t-transparent" />
              <span>Querying TRACE audit engine and computing safety synthesis…</span>
            </div>
          )}
        </div>

        {/* Dynamic Suggestions Bar if messages exist */}
        {messages.length > 0 && suggestions.length > 0 && !loading && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-t border-line bg-surface/50 px-3 py-1.5">
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
          className="flex items-center gap-2 border-t border-line bg-paper p-2 sm:p-2.5"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about events, bays, protocols, near misses, or stability…"
            className="flex-1 border border-line bg-surface px-3 py-1.5 text-small text-ink focus:border-ink focus:outline-none placeholder:text-ink-faint"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-1.5 border border-ink bg-ink px-3.5 py-1.5 text-small font-semibold text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
          >
            <Send size={13} />
            <span>Ask</span>
          </button>
        </form>
      </section>
    </div>
  )
}

function AssistantBubble({ msg, onFollowUp, navigateTo }) {
  const [showGrounding, setShowGrounding] = useState(false)
  const [showCards, setShowCards] = useState(true)
  const [selectedCardFilter, setSelectedCardFilter] = useState('all')

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

  // Plain conversation (a "hi", a "thanks") gets a plain reply — no audit
  // footer, no metrics grid, nothing that makes small talk look like a
  // database report.
  if (msg.intent === 'greetings' || msg.intent === 'small_talk') {
    return (
      <div className="flex flex-col gap-2 max-w-[75%]">
        <div className="flex items-start gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-paper">
            <Bot size={13} />
          </span>
          <div className="rounded-2xl rounded-tl-sm border border-line bg-paper px-3.5 py-2 text-small leading-relaxed text-ink shadow-xs">
            {msg.answer}
          </div>
        </div>
        {followups.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pl-8">
            {followups.map((f, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onFollowUp(f)}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-caption text-ink hover:border-ink hover:bg-paper transition-all cursor-pointer"
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

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

        {/* Render Interactive Event Cards in Dropdown */}
        {cards.length > 0 && (
          <div className="mt-3.5 border-t border-line pt-2.5">
            <button
              type="button"
              onClick={() => setShowCards((prev) => !prev)}
              aria-expanded={showCards}
              className="group flex w-full items-center justify-between rounded-xs border border-line bg-surface px-3 py-2 text-left transition-all hover:border-line-strong hover:bg-paper"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-xs bg-ink/10 font-mono text-[11px] font-bold text-ink">
                  {cards.length}
                </span>
                <span className="text-caption font-bold uppercase tracking-wider text-ink">
                  Related Event Records
                </span>
                <span className="text-[11px] text-ink-faint">
                  — {showCards ? 'Click to collapse' : 'Click to inspect incident replay & footage'}
                </span>
              </div>
              <ChevronDown
                size={14}
                className={`text-ink-soft transition-transform duration-200 group-hover:text-ink ${
                  showCards ? 'rotate-180 text-ink' : ''
                }`}
              />
            </button>

            {showCards && (
              <div className="mt-2.5 space-y-2 border-l-2 border-line pl-2 pt-1 animate-in fade-in duration-150">
                {cards.length > 1 && (
                  <div className="flex items-center justify-between gap-2 border border-line bg-surface p-2 text-caption rounded-xs">
                    <span className="font-semibold text-ink-soft text-[11px]">Filter by record:</span>
                    <select
                      value={selectedCardFilter}
                      onChange={(e) => setSelectedCardFilter(e.target.value)}
                      className="border border-line bg-paper px-2 py-0.5 text-caption text-ink focus:outline-none rounded-xs font-medium"
                    >
                      <option value="all">View all ({cards.length} records)</option>
                      {cards.map((c) => (
                        <option key={c.event_id} value={String(c.event_id)}>
                          #{c.event_id} · [{c.band}] {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2">
                  {(selectedCardFilter === 'all'
                    ? cards
                    : cards.filter((c) => String(c.event_id) === selectedCardFilter)
                  ).map((card) => (
                    <EventCard key={card.event_id} card={card} navigateTo={navigateTo} />
                  ))}
                </div>
              </div>
            )}
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
              className="inline-flex items-center gap-1 font-medium underline hover:text-ink text-ink-soft transition-colors"
            >
              <span>{showGrounding ? 'Hide audit trace' : 'View audit trace'}</span>
              <ChevronDown
                size={12}
                className={`transition-transform duration-200 ${showGrounding ? 'rotate-180' : ''}`}
              />
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
  const sevStyle = severityColors[card.band?.toLowerCase()] || severityColors.medium

  return (
    <div className="border border-line bg-surface p-3 transition-colors hover:border-line-strong">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-caption font-bold text-ink">#{card.event_id}</span>
          <span className={`border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${sevStyle}`}>
            {card.band}
          </span>
          <span className="text-caption font-semibold text-ink">{card.title}</span>
        </div>
        <div className="flex items-center gap-2 text-caption text-ink-faint">
          <span className="inline-flex items-center gap-1">
            <Video size={11} />
            {card.camera_name || card.video_id}
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
              videoId: card.video_id,
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
              videoId: card.video_id,
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

// Labels the backend's answer templates sometimes prefix a sentence with.
// Rendered as a natural inline lead-in ("Recommended: ...") rather than a
// separate boxed card per label — a person relaying this over radio
// wouldn't put a different colored box around every clause.
const INLINE_LABELS = [
  [/^(Supervisor tip|Recommended supervisor focus|Safety Protocol|Safety Rule|Shift Safety Summary|Shift Safety Handover Briefing|Executive Summary|Safety Briefing|High Risk Summary|Stability Formula & Safety Checks|Active Interventions|Main issue today|Primary operational hazard|Primary Hazard|Risk Description):?\s*/i, null],
]

// The one line type that genuinely deserves a visual accent: something the
// supervisor needs to physically go and do right now.
const ACTION_RE = /^(Action required|Immediate action):?\s*(.*)$/i

function renderFormattedAnswer(text) {
  if (!text) return null

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  // A short answer (the common case) should just read as one paragraph, not
  // a stack of single-line blocks — only split into a list when the answer
  // actually contains numbered/bulleted items.
  const looksLikeList = lines.some((l) => /^(\d+[.)]|[•\-*])\s/.test(l))

  if (!looksLikeList) {
    const actionLine = lines.find((l) => ACTION_RE.test(l))
    const prose = lines.filter((l) => l !== actionLine).map((l) => l.replace(INLINE_LABELS[0][0], ''))
    return (
      <div className="space-y-2.5">
        <p className="text-small leading-relaxed text-ink">{formatInline(prose.join(' '))}</p>
        {actionLine && (
          <div className="flex items-start gap-2 border-l-2 border-signal pl-2.5 py-0.5">
            <span className="text-small font-semibold text-ink leading-relaxed">
              {formatInline(actionLine.replace(ACTION_RE, '$2'))}
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {lines.map((line, idx) => {
        const actionMatch = line.match(ACTION_RE)
        if (actionMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 border-l-2 border-signal pl-2.5 py-0.5">
              <span className="text-small font-semibold text-ink leading-relaxed">
                {formatInline(actionMatch[2])}
              </span>
            </div>
          )
        }

        const numMatch = line.match(/^(\d+)[.)]\s*(.*)$/)
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-2.5 pl-1 py-0.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-paper mt-0.5">
                {numMatch[1]}
              </span>
              <div className="text-small leading-relaxed text-ink">{formatInline(numMatch[2])}</div>
            </div>
          )
        }

        if (line.startsWith('•') || line.startsWith('- ') || line.startsWith('* ')) {
          const content = line.replace(/^[•\-*]\s*/, '')
          return (
            <div key={idx} className="flex items-start gap-2 pl-2 py-0.5">
              <span className="text-ink font-bold leading-relaxed text-xs">•</span>
              <div className="text-small leading-relaxed text-ink">{formatInline(content)}</div>
            </div>
          )
        }

        return (
          <p key={idx} className="text-small leading-relaxed text-ink">
            {formatInline(line.replace(INLINE_LABELS[0][0], ''))}
          </p>
        )
      })}
    </div>
  )
}

function formatInline(str) {
  if (!str) return null
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

