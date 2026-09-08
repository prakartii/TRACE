import { ShieldAlert } from 'lucide-react'
import { useIntervention } from '../context/InterventionContext.jsx'

const STATUS = {
  online: { dot: 'bg-ok', label: 'backend online' },
  offline: { dot: 'bg-danger', label: 'backend offline' },
  checking: { dot: 'bg-line-strong', label: 'checking backend' },
}

export default function Header({ backendStatus }) {
  const s = STATUS[backendStatus] ?? STATUS.checking
  let activeCount = 0
  let connectionStatus = 'connecting'
  let setSelectedAlert = null
  let bannerAlert = null

  try {
    const intervention = useIntervention()
    activeCount = intervention.activeCount
    connectionStatus = intervention.connectionStatus
    setSelectedAlert = intervention.setSelectedAlert
    bannerAlert = intervention.bannerAlert
  } catch {
    // Graceful fallback if rendered outside provider
  }

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-3.5">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-[1.75rem] font-bold leading-none tracking-tight text-ink">
            TRACE<span className="text-signal">.</span>
          </span>
          <span className="hidden text-small text-ink-soft sm:inline">
            See what&apos;s about to go wrong. Know what to do instead.
          </span>
        </div>
        <div className="flex items-center gap-3">
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedAlert && bannerAlert && setSelectedAlert(bannerAlert)}
              className="flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-3 py-1 text-xs font-bold text-danger transition-transform hover:scale-105"
            >
              <ShieldAlert className="h-3.5 w-3.5 animate-pulse" />
              <span>{activeCount} {activeCount === 1 ? 'Alert' : 'Alerts'} Active</span>
            </button>
          )}

          <div className="flex items-center gap-1.5 font-mono text-caption text-ink-soft" title={`Real-time Stream: ${connectionStatus}`}>
            <span
              className={`h-2 w-2 rounded-full ${
                connectionStatus === 'connected' ? 'bg-ok' : connectionStatus === 'connecting' ? 'bg-signal' : 'bg-steel'
              }`}
            />
            <span>{connectionStatus === 'connected' ? 'live monitoring' : 'offline fallback'}</span>
          </div>

          <div className="h-3 w-px bg-line" />

          <div className="flex items-center gap-2 font-mono text-caption text-ink-soft">
            <span className={`h-2 w-2 ${s.dot}`} />
            {s.label}
          </div>
        </div>
      </div>
      <div className="h-1 bg-[repeating-linear-gradient(45deg,#1A1712_0_10px,#C28208_10px_20px)]" />
    </header>
  )
}

