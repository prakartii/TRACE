import { ShieldAlert, Volume2, VolumeX } from 'lucide-react'
import { useIntervention } from '../context/InterventionContext.jsx'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import { spokenTextFor } from '../lib/voiceAlerts.js'

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
  let voice = null

  try {
    const intervention = useIntervention()
    activeCount = intervention.activeCount
    connectionStatus = intervention.connectionStatus
    setSelectedAlert = intervention.setSelectedAlert
    bannerAlert = intervention.bannerAlert
    voice = intervention.voice
  } catch {
    // Graceful fallback if rendered outside provider
  }

  let role = 'supervisor'
  let setRole = null
  try {
    const ctx = useLiveViewContext()
    role = ctx.role
    setRole = ctx.setRole
  } catch {
    // Graceful fallback if rendered outside provider
  }

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-3.5">
        <div className="flex items-baseline gap-3">
          <span className="text-[1.75rem] font-bold leading-none tracking-tight text-ink">
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
              className="flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-3 py-1 text-caption font-bold text-danger transition-transform hover:scale-105 cursor-pointer"
            >
              <ShieldAlert className="h-3.5 w-3.5 animate-pulse" />
              <span>{activeCount} {activeCount === 1 ? 'Hazard Alert' : 'Hazard Alerts'} Active</span>
            </button>
          )}

          {voice?.supported && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const next = !voice.enabled
                  voice.setEnabled(next)
                  if (next) {
                    voice.speak(
                      bannerAlert
                        ? spokenTextFor(bannerAlert, voice.lang)
                        : 'Voice alerts on.',
                      { force: true },
                    )
                  }
                }}
                title={voice.enabled ? 'Voice alerts active' : 'Enable voice alerts'}
                className={`inline-flex items-center gap-1 text-caption font-medium transition-colors cursor-pointer ${
                  voice.enabled ? 'text-ink font-semibold' : 'text-ink-soft hover:text-ink'
                }`}
              >
                {voice.enabled ? <Volume2 size={13} className="text-signal" /> : <VolumeX size={13} />}
                <span>Voice</span>
              </button>
              {voice.enabled && (
                <select
                  value={voice.lang}
                  onChange={(e) => voice.setLang(e.target.value)}
                  className="border border-line bg-paper px-1 py-0.5 text-caption text-ink focus:border-ink"
                >
                  {voice.langs.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="h-3 w-px bg-line" />

          {/* Backend Status indicator */}
          <div className="flex items-center gap-1.5 font-mono text-caption text-ink-soft" title={s.label}>
            <span className={`h-2 w-2 rounded-full ${s.dot}`} />
            <span className="hidden sm:inline">{s.label}</span>
          </div>

          <div className="h-3 w-px bg-line" />

          {/* Role Switcher */}
          <div className="flex items-center gap-1.5 text-caption">
            <span className="font-medium text-ink-soft">Role:</span>
            <div
              className="inline-flex rounded border border-line bg-paper p-0.5"
              role="group"
              aria-label="Select role view"
            >
              <button
                type="button"
                onClick={() => setRole?.('supervisor')}
                className={`rounded px-2.5 py-0.5 text-caption font-medium transition-colors cursor-pointer ${
                  role === 'supervisor'
                    ? 'bg-ink text-paper font-semibold shadow-sm'
                    : 'text-ink-soft hover:text-ink hover:bg-surface'
                }`}
                title="Switch to Supervisor view (all screens & intelligence)"
              >
                Supervisor
              </button>
              <button
                type="button"
                onClick={() => setRole?.('operator')}
                className={`rounded px-2.5 py-0.5 text-caption font-medium transition-colors cursor-pointer ${
                  role === 'operator'
                    ? 'bg-ink text-paper font-semibold shadow-sm'
                    : 'text-ink-soft hover:text-ink hover:bg-surface'
                }`}
                title="Switch to Operator view (shop-floor operations)"
              >
                Operator
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="h-1 bg-[repeating-linear-gradient(45deg,#1A1712_0_10px,#C28208_10px_20px)]" />
    </header>
  )
}

