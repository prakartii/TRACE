export default function NavRail({ screens, active, onSelect }) {
  return (
    <nav className="w-56 shrink-0 py-6">
      <ul className="space-y-0.5">
        {screens.map((screen) => (
          <li key={screen}>
            <button
              type="button"
              onClick={() => onSelect(screen)}
              className={`w-full rounded px-3 py-1.5 text-left text-sm ${
                screen === active
                  ? 'bg-neutral-100 font-medium text-ink'
                  : 'text-neutral-500 hover:bg-neutral-50'
              }`}
            >
              {screen}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
