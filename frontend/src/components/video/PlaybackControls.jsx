import { formatDuration } from '../../lib/format.js'

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current">
      <path d="M4 2.5v11l9-5.5z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current">
      <rect x="3.5" y="2.5" width="3" height="11" />
      <rect x="9.5" y="2.5" width="3" height="11" />
    </svg>
  )
}

export default function PlaybackControls({
  playing,
  currentTime,
  duration,
  onTogglePlay,
  onSeekRatio,
}) {
  const ratio = duration > 0 ? Math.min(currentTime / duration, 1) : 0

  function handleTrackClick(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const clickRatio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
    onSeekRatio(Math.min(Math.max(clickRatio, 0), 1))
  }

  return (
    <div className="flex items-center gap-3 border-t border-line px-4 py-3">
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
        className="flex h-7 w-7 shrink-0 items-center justify-center border border-line bg-surface text-ink hover:bg-paper"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={currentTime}
        tabIndex={0}
        onClick={handleTrackClick}
        className="relative h-1.5 flex-1 cursor-pointer bg-line"
      >
        <div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${ratio * 100}%` }} />
      </div>

      <span className="w-24 shrink-0 text-right font-mono text-caption tabular-nums text-ink-soft">
        {formatDuration(currentTime)} / {formatDuration(duration)}
      </span>
    </div>
  )
}
