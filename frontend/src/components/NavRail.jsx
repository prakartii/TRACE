import {
  Crosshair,
  GitCompareArrows,
  LayoutGrid,
  Rewind,
  Settings,
  TriangleAlert,
  Video,
  Zap,
} from 'lucide-react'

const SCREEN_META = {
  Dashboard: { icon: LayoutGrid },
  'Scenario Coverage': { icon: Crosshair },
  Incidents: { icon: TriangleAlert },
  'Incident Replay': { icon: Rewind },
  'Action Center': { icon: Zap },
  'What-If Simulation': { icon: GitCompareArrows },
  'Live View': { icon: Video },
  Settings: { icon: Settings },
}

export default function NavRail({ screens, secondaryScreens = ['Settings'], active, onSelect }) {
  const renderItem = (screen) => {
    const meta = SCREEN_META[screen] || { icon: null }
    const Icon = meta.icon
    const isActive = screen === active
    return (
      <li key={screen}>
        <button
          type="button"
          onClick={() => onSelect(screen)}
          className={`relative flex w-full items-center gap-2.5 py-2 pl-3 pr-2 text-left text-small transition-colors ${
            isActive
              ? 'bg-ink font-semibold text-paper'
              : 'font-medium text-ink-soft hover:bg-surface hover:text-ink'
          }`}
        >
          {isActive && <span className="absolute inset-y-0 left-0 w-1 bg-[repeating-linear-gradient(45deg,#1A1712_0_10px,#C28208_10px_20px)]" />}
          {Icon && <Icon size={15} strokeWidth={2} className="shrink-0" />}
          <span>{screen}</span>
        </button>
      </li>
    )
  }

  return (
    <nav className="w-56 shrink-0 py-6 pr-5">
      <div className="mb-3 px-3">
        <span className="text-label font-medium text-ink-faint">
          Operational flow
        </span>
      </div>
      <ul className="space-y-0.5">{screens.map(renderItem)}</ul>

      {secondaryScreens?.length > 0 && (
        <>
          <div className="my-4 border-t border-line" />
          <div className="mb-3 px-3">
            <span className="text-label font-medium text-ink-faint">
              System
            </span>
          </div>
          <ul className="space-y-0.5">{secondaryScreens.map(renderItem)}</ul>
        </>
      )}
    </nav>
  )
}
