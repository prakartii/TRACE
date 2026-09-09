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

          {setRole && (
            <button
              type="button"
              onClick={() => setRole(role === 'operator' ? 'supervisor' : 'operator')}
              title="Responsible-AI view mode (presentation filter, not enforced access)"
              className="font-mono text-caption text-ink-soft hover:text-ink"
            >
              view: <span className="font-semibold text-ink">{role}</span>
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
                title={
                  voice.enabled
                    ? 'Voice alerts on'
                    : voice.voiceAvailable
                      ? 'Enable voice alerts'
                      : 'Enable voice alerts (no installed voice for this language — will read English)'
                }
                className={`inline-flex items-center gap-1 font-mono text-caption ${
                  voice.enabled ? 'text-ink' : 'text-ink-soft hover:text-ink'
                }`}
              >
                {voice.enabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                voice
              </button>
              {voice.enabled && (
                <select
                  value={voice.lang}
                  onChange={(e) => voice.setLang(e.target.value)}
                  className="border border-line bg-paper px-1 py-0.5 font-mono text-caption text-ink focus:border-ink"
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

