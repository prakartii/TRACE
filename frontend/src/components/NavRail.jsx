const SCREEN_ICONS = {
  Dashboard: '📊',
  Incidents: '🚨',
  'Incident Replay': '▶️',
  'Action Center': '⚡',
  'What-If Simulation': '🔮',
  'Live View': '📹',
  Settings: '⚙️',
}

const STEP_NUMBERS = {
  Dashboard: '01',
  Incidents: '02',
  'Incident Replay': '03',
  'Action Center': '04',
  'What-If Simulation': '05',
  'Live View': '06',
}

export default function NavRail({ screens, secondaryScreens = ['Settings'], active, onSelect }) {
  return (
    <nav className="w-56 shrink-0 py-6 pr-4">
      <div className="mb-3 px-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
          Operational Flow
        </span>
      </div>
      <ul className="space-y-1">
        {screens.map((screen) => {
          const isActive = screen === active
          return (
            <li key={screen}>
              <button
                type="button"
                onClick={() => onSelect(screen)}
                className={`w-full rounded px-3 py-2 text-left text-xs flex items-center justify-between transition-colors ${
                  isActive
                    ? 'bg-neutral-900 text-white font-bold shadow-xs'
                    : 'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 font-medium'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{SCREEN_ICONS[screen] || '•'}</span>
                  <span>{screen}</span>
                </span>
                {STEP_NUMBERS[screen] && (
                  <span className={`text-[10px] font-mono tabular-nums ${isActive ? 'text-neutral-400' : 'text-neutral-400'}`}>
                    {STEP_NUMBERS[screen]}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {secondaryScreens?.length > 0 && (
        <>
          <div className="my-4 border-t border-line/60" />
          <div className="mb-2 px-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
              System
            </span>
          </div>
          <ul className="space-y-1">
            {secondaryScreens.map((screen) => {
              const isActive = screen === active
              return (
                <li key={screen}>
                  <button
                    type="button"
                    onClick={() => onSelect(screen)}
                    className={`w-full rounded px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors ${
                      isActive
                        ? 'bg-neutral-900 text-white font-bold'
                        : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 font-medium'
                    }`}
                  >
                    <span>{SCREEN_ICONS[screen] || '•'}</span>
                    <span>{screen}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </nav>
  )
}

