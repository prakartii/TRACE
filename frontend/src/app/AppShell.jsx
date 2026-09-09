import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Settings as SettingsIcon, ShieldAlert, Volume2, VolumeX } from 'lucide-react'
import { API_BASE_URL } from '../config.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import { useIntervention } from '../context/InterventionContext.jsx'
import InterventionBanner from '../components/intervention/InterventionBanner.jsx'
import InterventionModal from '../components/intervention/InterventionModal.jsx'
import { spokenTextFor } from '../lib/voiceAlerts.js'
import { MIGRATING_NAV, OPERATOR_PATHS, PRIMARY_NAV } from './nav.js'

function useBackendStatus() {
  const [status, setStatus] = useState('checking')
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE_URL}/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(() => !cancelled && setStatus('online'))
      .catch(() => !cancelled && setStatus('offline'))
    return () => {
      cancelled = true
    }
  }, [])
  return status
}

const navItemClass = ({ isActive }) =>
  [
    'flex items-center gap-2.5 rounded px-2.5 py-2 text-body transition-colors',
    isActive
      ? 'bg-ink font-semibold text-bg'
      : 'text-dim hover:bg-raised hover:text-ink',
  ].join(' ')

function NavGroup({ label, items }) {
  if (!items.length) return null
  return (
    <div className="flex flex-col gap-0.5">
      {label && <span className="eyebrow mb-1.5 px-2.5">{label}</span>}
      {items.map(({ label: text, path, icon: Icon }) => (
        <NavLink key={path} to={path} className={navItemClass}>
          <Icon size={15} strokeWidth={2} className="shrink-0" />
          <span>{text}</span>
        </NavLink>
      ))}
    </div>
  )
}

function VoiceControl({ voice, bannerAlert }) {
  if (!voice?.supported) return null
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          const next = !voice.enabled
          voice.setEnabled(next)
          if (next) {
            voice.speak(
              bannerAlert ? spokenTextFor(bannerAlert, voice.lang) : 'Voice alerts on.',
              { force: true },
            )
          }
        }}
        title={voice.enabled ? 'Voice alerts on' : 'Enable voice alerts'}
        className={`inline-flex items-center gap-1 ${
          voice.enabled ? 'text-ink' : 'text-dim hover:text-ink'
        }`}
      >
        {voice.enabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
        <span>voice</span>
      </button>
      {voice.enabled && (
        <select
          value={voice.lang}
          onChange={(e) => voice.setLang(e.target.value)}
          className="border border-line bg-bg px-1 py-0.5 text-caption text-ink focus:border-ink"
        >
          {voice.langs.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

export default function AppShell() {
  const backend = useBackendStatus()
  const { role, setRole } = useLiveViewContext()
  const { activeCount, connectionStatus, bannerAlert, selectedAlert, setSelectedAlert, voice } =
    useIntervention()

  const isOperator = role === 'operator'
  const primary = isOperator
    ? PRIMARY_NAV.filter((n) => OPERATOR_PATHS.includes(n.path))
    : PRIMARY_NAV

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="flex h-12 items-center justify-between border-b border-line px-5">
        <span className="font-semibold tracking-[0.04em]">TRACE</span>

        <div className="flex items-center gap-4 text-caption text-dim">
          <span className="flex items-center gap-1.5" title={`real-time stream: ${connectionStatus}`}>
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-ok'
                  : connectionStatus === 'connecting'
                    ? 'bg-high'
                    : 'bg-mute'
              }`}
            />
            {connectionStatus === 'connected' ? 'live monitoring' : 'offline fallback'}
          </span>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => bannerAlert && setSelectedAlert(bannerAlert)}
              className="flex items-center gap-1 font-mono text-caption text-crit hover:underline"
            >
              <ShieldAlert size={13} />
              {activeCount} active
            </button>
          )}

          <VoiceControl voice={voice} bannerAlert={bannerAlert} />

          <button
            type="button"
            onClick={() => setRole(isOperator ? 'supervisor' : 'operator')}
            title="View mode (presentation filter, not enforced access)"
            className="font-mono text-caption text-dim hover:text-ink"
          >
            view: <span className="font-semibold text-ink">{role}</span>
          </button>

          <span className="flex items-center gap-1.5" title={`backend ${backend}`}>
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                backend === 'online' ? 'bg-ok' : backend === 'offline' ? 'bg-crit' : 'bg-mute'
              }`}
            />
            {backend}
          </span>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1180px]">
        <nav className="flex w-52 shrink-0 flex-col gap-5 border-r border-line px-3 py-6">
          <NavGroup items={primary} />
          {!isOperator && (
            <>
              <div className="border-t border-line" />
              <NavGroup items={[{ label: 'Settings', path: '/settings', icon: SettingsIcon }]} />
              <NavGroup label="Migrating" items={MIGRATING_NAV} />
            </>
          )}
        </nav>

        <main className="min-w-0 flex-1 px-7 py-6">
          <InterventionBanner onOpenDetail={setSelectedAlert} />
          <Outlet />
        </main>
      </div>

      {selectedAlert && (
        <InterventionModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      )}
    </div>
  )
}
