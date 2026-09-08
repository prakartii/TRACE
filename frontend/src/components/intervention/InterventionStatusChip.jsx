import { ShieldAlert, ShieldCheck, CheckCircle2, Clock, AlertTriangle, XCircle } from 'lucide-react'

export const INTERVENTION_STATE_CONFIG = {
  NEW: {
    label: 'ACTIVE ALERT',
    style: 'bg-danger/10 text-danger border-danger/40',
    icon: ShieldAlert,
  },
  ACKNOWLEDGED: {
    label: 'ACKNOWLEDGED',
    style: 'bg-signal/10 text-[#8a5f00] border-signal/40',
    icon: Clock,
  },
  ACTION_IN_PROGRESS: {
    label: 'ACTION IN PROGRESS',
    style: 'bg-steel/10 text-steel border-steel/40',
    icon: AlertTriangle,
  },
  VERIFICATION_REQUIRED: {
    label: 'VERIFY REQUIRED',
    style: 'bg-signal/15 text-[#8a5f00] border-signal/50',
    icon: AlertTriangle,
  },
  RESOLVED: {
    label: 'RESOLVED (PREVENTED)',
    style: 'bg-ok/10 text-ok border-ok/40',
    icon: CheckCircle2,
  },
  FALSE_POSITIVE: {
    label: 'FALSE POSITIVE',
    style: 'bg-paper text-ink-soft border-line-strong',
    icon: XCircle,
  },
}

export default function InterventionStatusChip({ state, severity = null, onClick = null, compact = false }) {
  const cfg = INTERVENTION_STATE_CONFIG[state] || INTERVENTION_STATE_CONFIG.NEW
  const Icon = cfg.icon

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium tracking-wide transition-colors ${
        cfg.style
      } ${onClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'} ${
        compact ? 'px-1.5 py-0 text-[11px]' : ''
      }`}
      title={onClick ? 'Click to inspect intervention details' : undefined}
    >
      <Icon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      <span>{cfg.label}</span>
      {severity && state === 'NEW' && (
        <span className="ml-1 rounded bg-danger px-1 text-[10px] font-bold text-white uppercase">
          {severity}
        </span>
      )}
    </button>
  )
}
