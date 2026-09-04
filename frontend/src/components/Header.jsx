const STATUS_COLOR = {
  online: 'bg-emerald-500',
  offline: 'bg-red-500',
  checking: 'bg-neutral-300',
}

export default function Header({ backendStatus }) {
  return (
    <header className="flex items-center justify-between border-b border-line px-8 py-4">
      <div className="flex items-baseline gap-3">
        <span className="text-base font-semibold tracking-tight">TRACE</span>
        <span className="text-sm text-neutral-500">
          See what&apos;s about to go wrong. Know what to do instead.
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[backendStatus] ?? STATUS_COLOR.checking}`} />
        backend: {backendStatus}
      </div>
    </header>
  )
}
