import { useCallback, useEffect, useState } from 'react'
import { getGovernanceStatus, getRetention, putRetention, runPurge } from '../api/responsibleAi.js'
import { listEvents, submitReview } from '../api/events.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'

function Section({ title, children }) {
  return (
    <section className="panel">
      <span className="eyebrow mb-3 block">{title}</span>
      {children}
    </section>
  )
}

function Row({ k, v, tone }) {
  return (
    <div className="flex justify-between gap-4 py-0.5 text-caption">
      <span className="text-mute">{k}</span>
      <span className={tone === 'ok' ? 'text-ok' : tone === 'crit' ? 'text-crit' : ''}>{v}</span>
    </div>
  )
}

function Dist({ dist }) {
  const entries = Object.entries(dist || {})
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-caption text-dim">
      {entries.map(([k, n]) => (
        <span key={k}>
          {k}: <span className="tabular-nums text-ink">{n}</span>
        </span>
      ))}
    </div>
  )
}

export default function SettingsGovernance() {
  const { role, setRole } = useLiveViewContext()
  const [status, setStatus] = useState(null)
  const [retention, setRetention] = useState(null)
  const [pending, setPending] = useState([])
  const [error, setError] = useState(null)
  const [purgePreview, setPurgePreview] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [s, r, unreviewed] = await Promise.all([
        getGovernanceStatus(),
        getRetention(),
        listEvents({ reviewed: false, limit: 200 }),
      ])
      setStatus(s)
      setRetention(r)
      setPending(
        (unreviewed || []).filter(
          (e) =>
            ['High', 'Critical'].includes(e.band) &&
            (e.confidence === 'Low' || ['probable', 'insufficient_evidence'].includes(e.status)),
        ),
      )
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

  async function saveRetention(patch) {
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
    <div className="flex flex-col gap-4">
      {error && <p className="font-mono text-caption text-crit">[error] {error}</p>}

      {status?.disclosures?.transparency_notice && (
        <p className="border-l-2 border-line-strong pl-2.5 text-caption text-dim">
          {status.disclosures.transparency_notice}
        </p>
      )}

      <Section title="View mode">
        <div className="flex flex-wrap items-center gap-2">
          {['supervisor', 'operator'].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`rounded-md border px-3 py-1 text-caption ${
                role === r
                  ? 'border-ink bg-ink text-bg'
                  : 'border-line-strong bg-bg text-dim hover:text-ink'
              }`}
            >
              {r}
            </button>
          ))}
          <span className="text-label text-mute">
            Operator view limits the nav to Monitor and Incidents. Presentation filter only — no
            authentication layer.
          </span>
        </div>
      </Section>

      {status && (
        <>
          <Section title="Face redaction">
            <Row
              k="status"
              v={status.face_redaction.enabled ? 'on by default' : 'disabled'}
              tone={status.face_redaction.enabled ? 'ok' : 'crit'}
            />
            <Row k="method" v={status.face_redaction.method} />
            <Row k="applies to" v={status.face_redaction.applies_to} />
            <Row k="response header" v={status.face_redaction.response_header} />
            <p className="mt-1.5 text-label text-mute">{status.face_redaction.note}</p>
          </Section>

          <Section title="Human review">
            <div className="mb-3 flex gap-6 font-mono text-caption">
              <span>
                awaiting: <span className="tabular-nums">{pending.length}</span>
              </span>
              <span>
                confirmed damage:{' '}
                <span className="tabular-nums text-crit">{status.human_review.confirmed_damage}</span>
              </span>
              <span>
                false positive:{' '}
                <span className="tabular-nums text-dim">{status.human_review.false_positive}</span>
              </span>
            </div>
            <p className="mb-3 text-label text-mute">{status.human_review.note}</p>

            {pending.length === 0 ? (
              <p className="text-caption text-mute">
                No High/Critical low-confidence findings are awaiting review.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-line rounded-md border border-line">
                {pending.map((e) => (
                  <div key={e.event_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-caption">
                    <span>
                      <span className="font-mono">#{e.event_id}</span> {e.scenario}{' '}
                      <span className="text-mute">
                        · {e.band} · {e.confidence} · {e.status}
                      </span>
                    </span>
                    <span className="flex gap-1.5">
                      {[
                        ['unresolved', 'mark reviewed'],
                        ['false_positive', 'false positive'],
                        ['confirmed_damage', 'confirm damage'],
                      ].map(([s, label]) => (
                        <button
                          key={s}
                          type="button"
                          disabled={busy}
                          onClick={() => review(e.event_id, s)}
                          className="rounded border border-line-strong bg-bg px-2 py-0.5 text-label text-dim hover:text-ink disabled:opacity-50"
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Confidence & evidence">
            <p className="mb-1 text-label text-mute">confidence</p>
            <Dist dist={status.confidence_distribution} />
            <p className="mb-1 mt-3 text-label text-mute">epistemic status</p>
            <Dist dist={status.epistemic_distribution} />
          </Section>

          {retention && (
            <Section title="Data retention">
              <div className="flex flex-wrap items-end gap-4">
                <label className="text-caption text-dim">
                  window (days)
                  <input
                    type="number"
                    min="1"
                    value={retention.window_days}
                    onChange={(e) =>
                      setRetention({ ...retention, window_days: Number(e.target.value) || 1 })
                    }
                    onBlur={() => saveRetention({})}
                    className="ml-2 w-20 rounded border border-line-strong bg-bg px-2 py-1 font-mono text-caption text-ink focus:border-ink"
                  />
                </label>
                <label className="flex items-center gap-2 text-caption text-dim">
                  <input
                    type="checkbox"
                    checked={retention.auto_purge}
                    onChange={(e) => saveRetention({ auto_purge: e.target.checked })}
                    className="accent-ink"
                  />
                  auto-purge on startup
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => doPurge(false)}
                  className="rounded-md border border-line-strong bg-bg px-3 py-1 text-caption text-dim hover:text-ink disabled:opacity-50"
                >
                  preview purge
                </button>
              </div>

              {purgePreview && (
                <div className="mt-3 rounded-md border border-line bg-bg p-3 text-caption">
                  <p className="text-dim">
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
                      className="mt-2 rounded-md border border-crit bg-crit px-3 py-1 text-caption font-medium text-bg disabled:opacity-50"
                    >
                      run purge now
                    </button>
                  )}
                </div>
              )}

              <p className="mt-2 text-label text-mute">
                Purge removes aged false-positive flags, session ratings, and resolved intervention
                alerts. Events and verified prevention outcomes are never targeted.
                {retention.last_purge?.at && (
                  <> Last purge: {new Date(retention.last_purge.at * 1000).toLocaleString()} (
                  {retention.last_purge.total} removed).</>
                )}
              </p>
            </Section>
          )}

          <Section title="Disclosures">
            <div className="flex flex-col gap-2.5">
              {[
                ['Stability estimates', status.disclosures.stability],
                ['Worker-independent analysis', status.disclosures.worker_independent],
                ['Non-punitive framing', status.disclosures.non_punitive],
                [
                  'Grounded assistant',
                  `${status.assistant.note}${
                    status.assistant.llm_available
                      ? ` Model: ${status.assistant.model}.`
                      : ' No language model configured.'
                  }`,
                ],
              ].map(([t, text]) => (
                <div key={t} className="border-l-2 border-line-strong pl-2.5">
                  <div className="text-caption font-medium">{t}</div>
                  <p className="text-label text-mute">{text}</p>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
