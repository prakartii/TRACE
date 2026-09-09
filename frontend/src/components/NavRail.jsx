import {
  Boxes,
  Crosshair,
  GitCompareArrows,
  LayoutGrid,
  MessagesSquare,
  Rewind,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Video,
  Zap,
} from 'lucide-react'

const SCREEN_META = {
  'Live View': {
    label: '1. Live Camera Feeds',
    icon: Video,
    badge: 'LIVE',
    badgeStyle: 'bg-danger text-paper font-semibold',
    category: 'operations',
  },
  Incidents: {
    label: '2. Active Hazards',
    icon: TriangleAlert,
    category: 'operations',
  },
  'Incident Replay': {
    label: '3. Incident Replay',
    icon: Rewind,
    category: 'operations',
  },
  'What-If Simulation': {
    label: '4. What-If Simulator',
    icon: GitCompareArrows,
    category: 'operations',
  },
  'Action Center': {
    label: '5. Safe Action Center',
    icon: Zap,
    category: 'operations',
  },
  Dashboard: {
    label: 'Safety Overview',
    icon: LayoutGrid,
    category: 'intelligence',
  },
  'Scenario Coverage': {
    label: '14 Hazard Scenarios',
    icon: Crosshair,
    category: 'intelligence',
  },
  'Structural View': {
    label: 'Structural 2D View',
    icon: Boxes,
    category: 'intelligence',
  },
  Assistant: {
    label: 'AI Safety Assistant',
    icon: MessagesSquare,
    badge: 'AI',
    badgeStyle: 'bg-signal/20 text-[#8a5f00] font-bold',
    category: 'governance',
  },
  'Responsible AI': {
    label: 'Worker Privacy & Ethics',
    icon: ShieldCheck,
    category: 'governance',
  },
  Settings: {
    label: 'Safety Rules & Catalog',
    icon: Settings,
    category: 'governance',
  },
}

const OPERATIONS_ORDER = [
  'Live View',
  'Incidents',
  'Incident Replay',
  'What-If Simulation',
  'Action Center',
]

export default function NavRail({ screens, secondaryScreens = ['Responsible AI', 'Settings'], active, onSelect }) {
  const allScreens = [...screens, ...(secondaryScreens || [])]

  // Group screens into intuitive workflow sections with operations strictly in 1-5 sequence
  const operationsScreens = OPERATIONS_ORDER.filter((s) => allScreens.includes(s))
  const intelligenceScreens = allScreens.filter((s) => SCREEN_META[s]?.category === 'intelligence')
  const governanceScreens = allScreens.filter((s) => SCREEN_META[s]?.category === 'governance')

  const renderItem = (screen) => {
    const meta = SCREEN_META[screen] || { label: screen, icon: null }
    const Icon = meta.icon
    const isActive = screen === active || (screen === 'Dashboard' && active === 'Safety Overview')
    const displayLabel = meta.label || screen

    return (
      <li key={screen}>
        <button
          type="button"
          onClick={() => onSelect(screen)}
          className={`group relative flex w-full items-center justify-between py-2 pl-3 pr-2.5 text-left text-small transition-colors ${
            isActive
              ? 'bg-ink font-semibold text-paper shadow-sm'
              : 'font-medium text-ink-soft hover:bg-surface hover:text-ink'
          }`}
        >
          {isActive && (
            <span className="absolute inset-y-0 left-0 w-1 bg-signal" />
          )}
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && (
              <Icon
                size={15}
                strokeWidth={isActive ? 2.2 : 1.8}
                className={`shrink-0 ${isActive ? 'text-signal' : 'text-ink-soft group-hover:text-ink'}`}
              />
            )}
            <span className="truncate">{displayLabel}</span>
          </div>
          {meta.badge && (
            <span
              className={`rounded px-1.5 py-0.2 text-[9px] uppercase tracking-wider ${
                meta.badgeStyle || 'bg-line text-ink'
              }`}
            >
              {meta.badge}
            </span>
          )}
        </button>
      </li>
    )
  }

  return (
    <nav className="w-60 shrink-0 py-6 pr-5">
      {operationsScreens.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 px-3">
            <span className="text-label font-semibold uppercase tracking-wider text-ink-faint">
              Operations & Safety
            </span>
          </div>
          <ul className="space-y-0.5">{operationsScreens.map(renderItem)}</ul>
        </div>
      )}

      {intelligenceScreens.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 px-3">
            <span className="text-label font-semibold uppercase tracking-wider text-ink-faint">
              Safety Intelligence
            </span>
          </div>
          <ul className="space-y-0.5">{intelligenceScreens.map(renderItem)}</ul>
        </div>
      )}

      {governanceScreens.length > 0 && (
        <div>
          <div className="mb-2 px-3">
            <span className="text-label font-semibold uppercase tracking-wider text-ink-faint">
              Supervisor & Ethics
            </span>
          </div>
          <ul className="space-y-0.5">{governanceScreens.map(renderItem)}</ul>
        </div>
      )}
    </nav>
  )
}
