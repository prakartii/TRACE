import { useCallback, useEffect, useState } from 'react'
import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  EyeOff,
  Info,
  Layers,
  Scale,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react'
import {
  getGovernanceStatus,
  getRetention,
  putRetention,
  runPurge,
} from '../api/responsibleAi.js'
import { listEvents, submitReview } from '../api/events.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import { getScenarioConfig } from '../lib/scenarios.js'
import { humanizeTitle } from '../lib/format.js'

export default function ResponsibleAI() {
  const { role } = useLiveViewContext()
  const [status, setStatus] = useState(null)
  const [retention, setRetention] = useState(null)
  const [queue, setQueue] = useState({ pending: [], confirmed: [], falsePos: [] })
  const [error, setError] = useState(null)
  const [purgePreview, setPurgePreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showTechnical, setShowTechnical] = useState(false)
  const [showRetentionModal, setShowRetentionModal] = useState(false)
  const [customDays, setCustomDays] = useState(30)

  const refresh = useCallback(async () => {
    try {
      const [s, r, unreviewed, confirmed, fp] = await Promise.all([
        getGovernanceStatus().catch(() => null),
        getRetention().catch(() => null),
        listEvents({ reviewed: false, limit: 100 }).catch(() => []),
        listEvents({ reviewStatus: 'confirmed_damage', limit: 50 }).catch(() => []),
        listEvents({ reviewStatus: 'false_positive', limit: 50 }).catch(() => []),
      ])
      setStatus(s)
      setRetention(r)
      if (r?.window_days) setCustomDays(r.window_days)

      const pending = (unreviewed || []).filter(
        (e) =>
          ['High', 'Critical'].includes(e.band) &&
          (e.confidence === 'Low' || ['probable', 'insufficient_evidence'].includes(e.status))
      )
      setQueue({ pending, confirmed: confirmed || [], falsePos: fp || [] })
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to load governance information')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleReview(eventId, reviewStatus) {
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

  async function handleSaveRetention(days) {
    if (!retention) return
    setBusy(true)
    try {
      const updated = await putRetention(days, retention.auto_purge ?? true)
      setRetention(updated)
      setShowRetentionModal(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handlePurge(confirm = false) {
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
    <div className="flex flex-col gap-8 pb-16 font-sans text-ink">
      {/* Header & Purpose Statement */}
      <section className="border-b border-line pb-5">
        <div className="flex items-center gap-2 text-label font-bold uppercase tracking-wider text-ok">
          <ShieldCheck size={16} />
          <span>Governance &amp; Worker Protection</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">
          Worker Privacy &amp; Ethics
        </h1>
        <p className="mt-2 max-w-3xl text-body text-ink font-medium leading-relaxed bg-paper border border-line p-4">
          “TRACE is designed to identify safety conditions and warehouse activity without identifying individual workers.”
        </p>
      </section>

      {error && (
        <div className="border border-danger/40 bg-danger/10 p-4 text-small text-danger">
          <strong>Notice:</strong> {error}
        </div>
      )}

      {/* 1. PRIVACY BY DEFAULT */}
      <section className="border border-line bg-surface p-6 shadow-xs">
        <div className="flex items-center gap-2.5 border-b border-line pb-3 mb-4">
          <div className="rounded-full bg-ok/10 p-1 text-ok">
            <EyeOff size={16} />
          </div>
          <h2 className="text-base font-bold text-ink uppercase tracking-wider">
            1. Privacy by Default
          </h2>
          <span className="ml-auto rounded-xs border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-bold uppercase text-ok">
            Enforced
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="border border-line bg-paper p-4">
            <span className="text-small font-bold text-ink block mb-1">
              Faces Obscured by Default
            </span>
            <p className="text-caption text-ink-soft leading-relaxed">
              Optical streams apply automated face blurring at the video edge before display. No recognizable facial biometric data is stored.
            </p>
          </div>

          <div className="border border-line bg-paper p-4">
            <span className="text-small font-bold text-ink block mb-1">
              No Identity-Based Worker Ranking
            </span>
            <p className="text-caption text-ink-soft leading-relaxed">
              TRACE never tracks individual employee productivity, speed, or identity. Incidents are tied to physical workstations, never individuals.
            </p>
          </div>

          <div className="border border-line bg-paper p-4">
            <span className="text-small font-bold text-ink block mb-1">
              No Worker Performance Scoring
            </span>
            <p className="text-caption text-ink-soft leading-relaxed">
              Risk analysis evaluates load physics and environmental safety margins only. The system prohibits individual punitive profiling.
            </p>
          </div>
        </div>
      </section>

      {/* 2. WHAT TRACE ANALYZES */}
      <section className="border border-line bg-surface p-6 shadow-xs">
        <div className="flex items-center gap-2.5 border-b border-line pb-3 mb-4">
          <div className="rounded-full bg-signal/10 p-1 text-signal">
            <Layers size={16} />
          </div>
          <h2 className="text-base font-bold text-ink uppercase tracking-wider">
            2. What TRACE Analyzes
          </h2>
        </div>

        <p className="text-small text-ink-soft mb-4">
          TRACE focuses strictly on physical object configurations, spatial margins, and warehouse environmental conditions:
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { title: 'Cargo', desc: 'Overpack mass classes, tier stacking order, and support contact.' },
            { title: 'Product Placement', desc: 'Orientation indicators (This Side Up) and pallet deck alignment.' },
            { title: 'Worker Motion', desc: 'Ergonomic lift posture, team handling, and fall clearance.' },
            { title: 'Warehouse Environment', desc: 'Dock ledge voids, spill puddles, and marked safety zones.' },
            { title: 'Safety Conditions', desc: 'Cantilever bending deflection and dynamic descent velocities.' },
          ].map((item) => (
            <div key={item.title} className="border border-line bg-paper p-3.5">
              <span className="block text-small font-bold text-ink mb-1">
                {item.title}
              </span>
              <span className="text-caption text-ink-soft leading-relaxed block">
                {item.desc}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 3. HUMAN REVIEW */}
      <section className="border border-line bg-surface p-6 shadow-xs">
        <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-full bg-steel/10 p-1 text-steel">
              <Scale size={16} />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink uppercase tracking-wider">
                3. Human Review
              </h2>
            </div>
          </div>
          <span className="font-mono text-caption text-ink-soft">
            {queue.pending.length} pending review
          </span>
        </div>

        <p className="text-small text-ink-soft mb-4">
          “TRACE does not independently confirm physical damage. A supervisor must review and confirm damage.”
        </p>

        {/* Review metrics summary */}
        <div className="grid grid-cols-3 gap-px border border-line bg-line mb-5">
          <div className="bg-paper p-3 text-center">
            <span className="block text-label font-bold uppercase text-ink-faint">Awaiting Review</span>
            <span className="text-xl font-bold font-mono text-signal">{queue.pending.length}</span>
          </div>
          <div className="bg-paper p-3 text-center">
            <span className="block text-label font-bold uppercase text-ink-faint">Confirmed Damage</span>
            <span className="text-xl font-bold font-mono text-danger">
              {status?.human_review?.confirmed_damage ?? queue.confirmed.length}
            </span>
          </div>
          <div className="bg-paper p-3 text-center">
            <span className="block text-label font-bold uppercase text-ink-faint">False Positives Flagged</span>
            <span className="text-xl font-bold font-mono text-ok">
              {status?.human_review?.false_positive ?? queue.falsePos.length}
            </span>
          </div>
        </div>

        {/* Review Queue List */}
        {queue.pending.length === 0 ? (
          <div className="border border-line bg-paper p-4 text-center text-small text-ink-soft">
            ✓ No high-priority findings currently require supervisor verification.
          </div>
        ) : (
          <div className="divide-y divide-line border border-line bg-paper">
            {queue.pending.slice(0, 5).map((ev) => {
              const cfg = getScenarioConfig(ev.scenario)
              const title = humanizeTitle(cfg.title || ev.scenario, ev.scenario)

              return (
                <div key={ev.event_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-caption font-bold text-ink">#{ev.event_id}</span>
                      <span className="text-small font-bold text-ink">{title}</span>
                      <span className="text-caption font-mono text-ink-soft">({ev.band} Risk)</span>
                    </div>
                    <p className="text-caption text-ink-soft mt-0.5">
                      Flagged for supervisor confirmation: verification needed before incident sign-off.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleReview(ev.event_id, 'unresolved')}
                      className="border border-line bg-surface px-2.5 py-1 text-caption font-medium text-ink hover:border-ink disabled:opacity-50 cursor-pointer"
                    >
                      Mark Reviewed
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleReview(ev.event_id, 'false_positive')}
                      className="border border-line bg-surface px-2.5 py-1 text-caption font-medium text-ink-soft hover:text-ink disabled:opacity-50 cursor-pointer"
                    >
                      False Positive
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleReview(ev.event_id, 'confirmed_damage')}
                      className="bg-danger px-2.5 py-1 text-caption font-bold text-paper transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
                    >
                      Confirm Damage
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 4. DATA RETENTION */}
      <section className="border border-line bg-surface p-6 shadow-xs">
        <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-full bg-line-strong/30 p-1 text-ink">
              <Clock size={16} />
            </div>
            <h2 className="text-base font-bold text-ink uppercase tracking-wider">
              4. Data Retention
            </h2>
          </div>
          <span className="rounded-xs border border-line bg-paper px-2 py-0.5 font-mono text-caption text-ink font-semibold">
            {retention?.window_days || 30} Days Storage Window
          </span>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border border-line bg-paper p-4">
          <div>
            <span className="text-small font-bold text-ink block">
              Automated Ephemeral Retention Window
            </span>
            <p className="text-caption text-ink-soft mt-0.5">
              Current retention policy: telemetry and event metadata are retained for{' '}
              <strong>{retention?.window_days || 30} days</strong> before automatic archival purging.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowRetentionModal(true)}
              className="border border-line bg-surface px-3 py-1.5 text-small font-semibold text-ink hover:border-ink cursor-pointer"
            >
              Change Retention
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handlePurge(false)}
              className="border border-line bg-surface px-3 py-1.5 text-small font-semibold text-ink hover:border-ink disabled:opacity-50 cursor-pointer"
            >
              Preview Purge
            </button>
          </div>
        </div>

        {/* Change Retention Inline Form */}
        {showRetentionModal && (
          <div className="mt-3 border border-line bg-surface p-4 flex flex-wrap items-center gap-3">
            <span className="text-small font-medium text-ink">Set retention window (days):</span>
            <input
              type="number"
              min={7}
              max={365}
              value={customDays}
              onChange={(e) => setCustomDays(Number(e.target.value))}
              className="border border-line bg-paper px-2.5 py-1 text-small font-mono text-ink w-24"
            />
            <button
              type="button"
              onClick={() => handleSaveRetention(customDays)}
              className="bg-ink px-3 py-1 text-small font-bold text-paper hover:bg-ink-soft cursor-pointer"
            >
              Save Policy
            </button>
            <button
              type="button"
              onClick={() => setShowRetentionModal(false)}
              className="text-caption text-ink-soft hover:text-ink cursor-pointer ml-2"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Purge Preview Banner */}
        {purgePreview && (
          <div className="mt-3 border border-signal/40 bg-signal/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-small font-bold text-ink block">Purge Candidate Records</span>
                <span className="text-caption text-ink-soft">
                  {purgePreview.total} aged record(s) older than {purgePreview.cutoff} are eligible for purge.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handlePurge(true)}
                  className="bg-danger px-3 py-1.5 text-small font-bold text-paper hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  Confirm Purge Now
                </button>
                <button
                  type="button"
                  onClick={() => setPurgePreview(null)}
                  className="border border-line bg-paper px-2.5 py-1.5 text-small text-ink hover:border-ink cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 5. EXPANDABLE TECHNICAL PRIVACY DETAILS */}
      <section className="border border-line bg-surface">
        <button
          type="button"
          onClick={() => setShowTechnical((v) => !v)}
          className="flex w-full items-center justify-between bg-paper px-5 py-3.5 text-small font-semibold text-ink-soft hover:text-ink cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Info size={15} className="text-ink-soft" />
            <span>Technical privacy details (Engineering Specifications &amp; Headers)</span>
          </div>
          <span className="font-mono text-caption text-ink-faint">
            {showTechnical ? '▲ collapse' : '▼ expand'}
          </span>
        </button>

        {showTechnical && (
          <div className="flex flex-col gap-3 border-t border-line p-5 text-caption text-ink-soft font-mono">
            <div className="border border-line bg-paper p-3">
              <span className="font-bold text-ink block mb-1">Redaction Mechanism:</span>
              <p>Method: {status?.face_redaction?.method || 'Edge bounding box pixelation'}</p>
              <p>Stream Transport Header: {status?.face_redaction?.response_header || 'X-TRACE-Redacted: faces'}</p>
              <p>Endpoint Scope: {status?.face_redaction?.applies_to || '/api/videos/{id}/stream'}</p>
            </div>

            <div className="border border-line bg-paper p-3">
              <span className="font-bold text-ink block mb-1">Role View Mode Filter:</span>
              <p className="font-sans text-[11px] text-ink-faint mt-1">
                Currently viewing as <strong className="text-ink font-semibold capitalize">{role}</strong>.
                Switch roles from the toggle in the top header — it filters which screens are visible
                (Operator sees only the live workflow; Supervisor sees the full toolset).
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
