const STATUS = {
  online: { dot: 'bg-ok', label: 'backend online' },
  offline: { dot: 'bg-danger', label: 'backend offline' },
  checking: { dot: 'bg-line-strong', label: 'checking backend' },
}

export default function Header({ backendStatus }) {
  const s = STATUS[backendStatus] ?? STATUS.checking
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
        <div className="flex items-center gap-2 font-mono text-caption text-ink-soft">
          <span className={`h-2 w-2 ${s.dot}`} />
          {s.label}
        </div>
      </div>
      <div className="h-1 bg-[repeating-linear-gradient(45deg,#1A1712_0_10px,#C28208_10px_20px)]" />
    </header>
  )
}
