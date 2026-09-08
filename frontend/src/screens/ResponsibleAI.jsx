import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, EyeOff, Scale, Trash2, UserCog } from 'lucide-react'
import { getGovernanceStatus, getRetention, putRetention, runPurge } from '../api/responsibleAi.js'
import { listEvents, submitReview } from '../api/events.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'

const OPERATOR_SCREENS = ['Live View', 'Action Center', 'Incidents', 'Incident Replay']

export default function ResponsibleAI() {
  const { role, setRole } = useLiveViewContext()
  const [status, setStatus] = useState(null)
  const [retention, setRetention] = useState(null)
  const [queue, setQueue] = useState({ pending: [], confirmed: [], falsePos: [] })
  const [error, setError] = useState(null)
  const [purgePreview, setPurgePreview] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [s, r, unreviewed, confirmed, fp] = await Promise.all([
        getGovernanceStatus(),
        getRetention(),
        listEvents({ reviewed: false, limit: 200 }),
        listEvents({ reviewStatus: 'confirmed_damage', limit: 50 }),
        listEvents({ reviewStatus: 'false_positive', limit: 50 }),
      ])
      setStatus(s)
      setRetention(r)
      const pending = (unreviewed || []).filter(
        (e) =>
          ['High', 'Critical'].includes(e.band) &&
          (e.confidence === 'Low' || ['probable', 'insufficient_evidence'].includes(e.status)),
      )
      setQueue({ pending, confirmed: confirmed || [], falsePos: fp || [] })
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to load')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function review(eventId, reviewStatus) {
    setBusy(true)
    try {
      await submitReview(eventId, reviewStatus)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function savedRetention(patch) {
    if (!retention) return
    const next = { ...retention, ...patch }
    setRetention(await putRetention(next.window_days, next.auto_purge))
    setPurgePreview(null)
  }

  async function doPurge(confirm) {
    setBusy(true)
    try {
      const res = await runPurge(confirm)
      if (confirm) {
        setPurgePreview(null)
        await refresh()
      } else {
        setPurgePreview(res)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      <section>
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-ok" />
          <h1 className="font-display text-display-lg font-semibold text-ink">Responsible AI</h1>
        </div>
        {status && (
          <p className="mt-2 max-w-3xl border-l-2 border-ok bg-ok/5 px-3 py-2 text-small text-ink">
            {status.disclosures.transparency_notice}
          </p>
        )}
      </section>

      {error && (
        <div className="border border-danger bg-danger/5 p-3 font-mono text-caption text-danger">{error}</div>
      )}

      {/* view mode */}
      <Card icon={UserCog} title="View mode">
        <div className="flex flex-wrap items-center gap-2">
          {['supervisor', 'operator'].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`px-3 py-1 text-small font-medium ${
                role === r ? 'bg-ink text-paper' : 'border border-line bg-paper text-ink-soft hover:text-ink'
              }`}
            >
              {r}
            </button>
          ))}
          <span className="text-caption text-ink-faint">
            Operator view hides {OPERATOR_SCREENS.length === 4 ? 'supervisor-only screens' : ''} (Dashboard,
            Scenario Coverage, What-If, Assistant, Settings, this page). Presentation filter only — there is
            no authentication layer yet.
          </span>
        </div>
      </Card>

      {status && (
        <>
          {/* face redaction */}
          <Card icon={EyeOff} title="Face redaction">
            <Row k="status" v={status.face_redaction.enabled ? 'ON by default' : 'disabled'}
                 tone={status.face_redaction.enabled ? 'ok' : 'danger'} />
            <Row k="method" v={status.face_redaction.method} />
            <Row k="applies to" v={status.face_redaction.applies_to} />
            <Row k="response header" v={status.face_redaction.response_header} mono />
            <p className="mt-1 text-caption text-ink-faint">{status.face_redaction.note}</p>
          </Card>

          {/* human review */}
          <Card icon={Scale} title="Human review">
            <div className="mb-3 grid grid-cols-3 gap-px border border-line bg-line text-center">
              <Stat label="awaiting review" value={queue.pending.length} tone="signal" />
              <Stat label="confirmed damage" value={status.human_review.confirmed_damage} tone="danger" />
              <Stat label="false positive" value={status.human_review.false_positive} tone="ink" />
            </div>
            <p className="mb-3 text-caption text-ink-faint">{status.human_review.note}</p>

            {queue.pending.length === 0 ? (
              <p className="text-small text-ink-soft">
                No High/Critical low-confidence findings are awaiting review.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-line border border-line">
                {queue.pending.map((e) => (
                  <div key={e.event_id} className="flex flex-wrap items-center justify-between gap-2 bg-surface p-2.5">
                    <div className="text-caption">
                      <span className="font-mono font-medium text-ink">#{e.event_id}</span>{' '}
                      <span className="text-ink-soft">{e.scenario}</span>{' '}
                      <span className="text-ink-faint">
                        · {e.band} · {e.confidence} confidence · {e.status}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => review(e.event_id, 'unresolved')}
                        className="border border-line bg-paper px-2 py-0.5 text-label text-ink-soft hover:text-ink disabled:opacity-50"
                      >
                        mark reviewed
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => review(e.event_id, 'false_positive')}
                        className="border border-line bg-paper px-2 py-0.5 text-label text-ink-soft hover:text-ink disabled:opacity-50"
                      >
                        false positive
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => review(e.event_id, 'confirmed_damage')}
                        className="bg-danger px-2 py-0.5 text-label font-medium text-paper hover:opacity-90 disabled:opacity-50"
                      >
                        confirm damage
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {queue.confirmed.length > 0 && (
              <p className="mt-2 text-caption text-ink-faint">
                confirmed by review: {queue.confirmed.map((e) => `#${e.event_id}`).join(', ')}
              </p>
            )}
          </Card>

          {/* distributions */}
          <Card icon={Scale} title="Confidence & evidence">
            <Dist label="confidence" dist={status.confidence_distribution} />
            <div className="mt-3" />
            <Dist label="epistemic status" dist={status.epistemic_distribution} />
            <p className="mt-2 text-caption text-ink-faint">
              Low-confidence and non-supported findings are surfaced for review rather than driving the same
              high-consequence UI treatment as supported ones.
            </p>
          </Card>

          {/* retention */}
          {retention && (
            <Card icon={Trash2} title="Data retention">
              <div className="flex flex-wrap items-end gap-4">
                <label className="text-caption text-ink-soft">
                  retention window (days)
                  <input
                    type="number"
                    min="1"
                    value={retention.window_days}
                    onChange={(e) =>
                      setRetention({ ...retention, window_days: Number(e.target.value) || 1 })
                    }
                    onBlur={() => savedRetention({})}
                    className="ml-2 w-24 border border-line bg-surface px-2 py-1 font-mono text-small text-ink focus:border-ink"
                  />
                </label>
                <label className="flex items-center gap-2 text-caption text-ink-soft">
                  <input
                    type="checkbox"
                    checked={retention.auto_purge}
                    onChange={(e) => savedRetention({ auto_purge: e.target.checked })}
                    className="accent-ink"
                  />
                  auto-purge on startup
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => doPurge(false)}
                  className="border border-ink px-3 py-1 text-small font-medium text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
                >
                  preview purge
                </button>
              </div>

              {purgePreview && (
                <div className="mt-3 border border-signal/40 bg-signal/5 p-3 text-small">
                  <p className="text-[#8a5f00]">
                    {purgePreview.total === 0
                      ? 'Nothing is older than the retention window.'
                      : `${purgePreview.total} record(s) older than ${purgePreview.window_days} days would be removed: `}
                    {purgePreview.total > 0 && (
                      <span className="font-mono">
                        {Object.entries(purgePreview.by_table)
                          .filter(([, n]) => n > 0)
                          .map(([t, n]) => `${t}:${n}`)
                          .join(', ')}
                      </span>
                    )}
                  </p>
                  {purgePreview.total > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => doPurge(true)}
                      className="mt-2 bg-danger px-3 py-1 text-small font-medium text-paper hover:opacity-90 disabled:opacity-50"
                    >
                      run purge now
                    </button>
                  )}
                </div>
              )}

              <p className="mt-2 text-caption text-ink-faint">
                Purge removes aged intervention, outcome, feedback and rating records that carry a real
                timestamp. Seeded demo records have no ingest time and are always retained.
                {retention.last_purge?.at && (
                  <>
                    {' '}
                    Last purge: {new Date(retention.last_purge.at * 1000).toLocaleString()} (
                    {retention.last_purge.total} removed).
                  </>
                )}
              </p>
            </Card>
          )}

          {/* disclosures */}
          <Card icon={ShieldCheck} title="Disclosures">
            <Disclosure title="Stability estimates" text={status.disclosures.stability} />
            <Disclosure title="Worker-independent analysis" text={status.disclosures.worker_independent} />
            <Disclosure title="Non-punitive framing" text={status.disclosures.non_punitive} />
            <Disclosure
              title="Grounded assistant"
              text={`${status.assistant.note}${
                status.assistant.llm_available ? ` Model: ${status.assistant.model}.` : ' No language model configured.'
              }`}
            />
          </Card>
        </>
      )}
    </div>
  )
}

function Card({ icon: Icon, title, children }) {
  return (
    <section className="border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        {Icon && <Icon size={14} className="text-ink-soft" />}
        <h2 className="font-mono text-caption font-semibold uppercase tracking-wider text-ink">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Row({ k, v, tone, mono }) {
  const toneCls = tone === 'ok' ? 'text-ok' : tone === 'danger' ? 'text-danger' : 'text-ink'
  return (
    <div className="flex justify-between gap-4 py-0.5 text-small">
      <span className="text-ink-faint">{k}</span>
      <span className={`${mono ? 'font-mono' : ''} ${toneCls}`}>{v}</span>
    </div>
  )
}

function Stat({ label, value, tone }) {
  const toneCls =
    tone === 'danger' ? 'text-danger' : tone === 'signal' ? 'text-[#8a5f00]' : 'text-ink'
  return (
    <div className="bg-paper p-3">
      <div className={`font-display text-display-md font-semibold tabular-nums ${toneCls}`}>{value}</div>
      <div className="text-label text-ink-faint">{label}</div>
    </div>
  )
}

function Dist({ label, dist }) {
  const entries = Object.entries(dist || {})
  const total = entries.reduce((a, [, n]) => a + n, 0) || 1
  return (
    <div>
      <div className="mb-1 text-label font-medium text-ink-faint">{label}</div>
      <div className="flex h-4 w-full overflow-hidden border border-line">
        {entries.map(([k, n]) => (
          <div
            key={k}
            title={`${k}: ${n}`}
            style={{ width: `${(n / total) * 100}%` }}
            className="bg-ink-soft first:bg-ink even:bg-ink-faint"
          />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-caption text-ink-soft">
        {entries.map(([k, n]) => (
          <span key={k}>
            {k}: <span className="font-mono tabular-nums">{n}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Disclosure({ title, text }) {
  return (
    <div className="border-l-2 border-line-strong py-1 pl-3">
      <div className="text-caption font-semibold text-ink">{title}</div>
      <p className="text-caption leading-relaxed text-ink-soft">{text}</p>
    </div>
  )
}
