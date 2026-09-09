import { useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Play,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react'
import { useIntervention } from '../../context/InterventionContext.jsx'
import { useLiveViewContext } from '../../LiveViewContext.jsx'
import InterventionStatusChip from './InterventionStatusChip.jsx'

export default function InterventionModal({ alert, onClose }) {
  const {
    acknowledgeAlert,
    progressAlert,
    verifyAlert,
    resolveAlert,
    dismissAlert,
  } = useIntervention()
  const { navigateTo } = useLiveViewContext()

  const [loading, setLoading] = useState(false)
  const [showTechnical, setShowTechnical] = useState(false)
  const [showDismissInput, setShowDismissInput] = useState(false)
  const [dismissReason, setDismissReason] = useState('')
  const [actionNotes, setActionNotes] = useState('')

  if (!alert) return null

  const isCritical = alert.severity === 'CRITICAL'
  const isHigh = alert.severity === 'HIGH'

  const handleAcknowledge = async () => {
    setLoading(true)
    try {
      await acknowledgeAlert(alert.alert_id, 'shift_supervisor')
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleProgress = async () => {
    setLoading(true)
    try {
      await progressAlert(alert.alert_id, actionNotes || 'Corrective action commenced')
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    setLoading(true)
    try {
      await verifyAlert(alert.alert_id, 'shift_supervisor', actionNotes || 'Verified physically')
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleResolve = async () => {
    setLoading(true)
    try {
      await resolveAlert(alert.alert_id, actionNotes || 'Corrective action verified safe', 'prevented')
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleDismiss = async () => {
    if (!dismissReason.trim()) return
    setLoading(true)
    try {
      await dismissAlert(alert.alert_id, dismissReason.trim())
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleNavigateReplay = () => {
    navigateTo('Incident Replay', {
      eventId: alert.event_id,
      videoId: alert.video_id,
      timestamp: alert.timestamp,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line bg-raised p-5">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                isCritical ? 'bg-crit text-white' : isHigh ? 'bg-high text-ink' : 'bg-dim text-white'
              }`}
            >
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${
                    isCritical ? 'bg-crit text-white' : isHigh ? 'bg-high text-ink' : 'bg-dim text-white'
                  }`}
                >
                  {alert.severity} — {alert.urgency}
                </span>
                <InterventionStatusChip state={alert.state} compact />
                {alert.occurrence_count > 1 && (
                  <span className="rounded border border-line bg-bg px-2 py-0.5 text-xs font-medium text-dim">
                    Repeated {alert.occurrence_count}×
                  </span>
                )}
              </div>
              <h2 className="mt-1 text-lg font-bold text-ink">{alert.title}</h2>
              <p className="text-xs text-dim">
                Observed in video <code className="font-mono text-[11px]">{alert.video_id.slice(0, 12)}</code> at{' '}
                {Math.floor(alert.timestamp / 60)}:{(alert.timestamp % 60).toFixed(1).padStart(4, '0')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-mute hover:bg-bg hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 1. WHAT TO DO NOW (Immediate Action Callout) */}
          <div className="rounded-xl border border-ink bg-ink p-4 text-bg shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-bg/70">
              Immediate Operational Action
            </span>
            <p className="mt-1 text-base font-bold text-bg">
              {alert.immediate_action}
            </p>
          </div>

          {/* 2. SEQUENTIAL ACTION STEPS */}
          {alert.steps && alert.steps.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-dim">
                Action Checklist
              </h4>
              <ol className="mt-2 space-y-2">
                {alert.steps.map((step, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-3 rounded-lg border border-line bg-raised p-3 text-sm text-ink"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-line-strong text-xs font-bold text-ink">
                      {idx + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* 3. WHY */}
          <div className="rounded-xl border border-line bg-raised p-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-dim">
              Why TRACE Flagged This
            </h4>
            <p className="mt-1 text-sm text-ink">{alert.reason}</p>
          </div>

          {/* 4. VERIFICATION */}
          <div className="rounded-xl border border-ok/40 bg-ok/5 p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-ok" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-ok">
                Safety Verification Standard
              </h4>
            </div>
            <p className="mt-1 text-sm font-medium text-ink">
              {alert.verification}
            </p>
          </div>

          {/* Inline Action Note (Optional) */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-dim">
              Operator / Supervisor Log Note (Optional)
            </label>
            <input
              type="text"
              value={actionNotes}
              onChange={(e) => setActionNotes(e.target.value)}
              placeholder="e.g. Load restacked by team lift; footing secured"
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-ink"
            />
          </div>

          {/* Progressive Disclosure: Technical Evidence */}
          <div className="border-t border-line pt-3">
            <button
              type="button"
              onClick={() => setShowTechnical(!showTechnical)}
              className="flex w-full items-center justify-between py-1 text-xs font-semibold text-dim hover:text-ink"
            >
              <span>Technical Sensor Grounding & Model Evidence</span>
              {showTechnical ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {showTechnical && (
              <div className="mt-3 space-y-2 rounded-lg border border-line bg-raised p-4 text-xs text-dim">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="font-semibold text-ink">Scenario ID:</span>{' '}
                    <code className="font-mono">{alert.scenario}</code>
                  </div>
                  <div>
                    <span className="font-semibold text-ink">Risk Lens:</span> {alert.lens}
                  </div>
                  <div>
                    <span className="font-semibold text-ink">Root Event ID:</span> #{alert.event_id}
                  </div>
                  <div>
                    <span className="font-semibold text-ink">Risk Score:</span>{' '}
                    {alert.score ? alert.score.toFixed(1) : 'N/A'} ({alert.band})
                  </div>
                  <div>
                    <span className="font-semibold text-ink">Sensor Status:</span>{' '}
                    {alert.evidence_status}
                  </div>
                  <div>
                    <span className="font-semibold text-ink">Supporting Event IDs:</span>{' '}
                    {alert.supporting_event_ids?.join(', ') || alert.event_id}
                  </div>
                </div>
                <div className="mt-2 border-t border-line pt-2 text-[11px] text-mute">
                  Responsible AI Notice: Decision-support signal derived deterministically from TRACE safety catalog and camera observations. Does not guarantee physical outcomes without operator inspection.
                </div>
              </div>
            )}
          </div>

          {/* False Positive Dismissal Box */}
          {showDismissInput && (
            <div className="rounded-xl border border-crit/30 bg-crit/5 p-4">
              <h4 className="text-xs font-bold text-crit">Mark Hazard as False Positive</h4>
              <p className="mt-1 text-xs text-dim">
                Provide operational rationale for the Responsible AI feedback registry:
              </p>
              <textarea
                rows={2}
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="e.g. Expected manual handling variance approved by supervisor"
                className="mt-2 w-full rounded-lg border border-line bg-bg p-2 text-xs text-ink outline-none focus:border-crit"
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDismissInput(false)}
                  className="rounded-lg border border-line bg-bg px-3 py-1.5 text-xs text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDismiss}
                  disabled={loading || !dismissReason.trim()}
                  className="rounded-lg bg-crit px-3 py-1.5 text-xs font-bold text-white hover:bg-crit/90 disabled:opacity-50"
                >
                  Confirm False Positive
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Operational Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-raised p-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNavigateReplay}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg px-3 py-2 text-xs font-medium text-ink hover:bg-raised active:scale-95"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Inspect Video Evidence</span>
            </button>

            {!showDismissInput && (
              <button
                type="button"
                onClick={() => setShowDismissInput(true)}
                className="rounded-lg px-2.5 py-2 text-xs text-mute hover:text-crit"
              >
                Mark False Positive
              </button>
            )}
          </div>

          {/* State progression buttons */}
          <div className="flex items-center gap-2">
            {alert.state === 'NEW' && (
              <button
                type="button"
                onClick={handleAcknowledge}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-xs font-bold text-bg shadow-sm hover:bg-dim active:scale-95 disabled:opacity-50"
              >
                <Clock className="h-3.5 w-3.5" />
                <span>Acknowledge Hazard</span>
              </button>
            )}

            {alert.state === 'ACKNOWLEDGED' && (
              <button
                type="button"
                onClick={handleProgress}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-high px-4 py-2 text-xs font-bold text-ink shadow-sm hover:bg-high/90 active:scale-95 disabled:opacity-50"
              >
                <ArrowRight className="h-3.5 w-3.5" />
                <span>Start Corrective Action</span>
              </button>
            )}

            {alert.state === 'ACTION_IN_PROGRESS' && (
              <button
                type="button"
                onClick={handleVerify}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-high px-4 py-2 text-xs font-bold text-ink shadow-sm hover:bg-high/90 active:scale-95 disabled:opacity-50"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Request Safety Verification</span>
              </button>
            )}

            {(alert.state === 'VERIFICATION_REQUIRED' || alert.state === 'ACTION_IN_PROGRESS') && (
              <button
                type="button"
                onClick={handleResolve}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ok px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-ok/90 active:scale-95 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Verify Safe & Resolve (Prevented)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
