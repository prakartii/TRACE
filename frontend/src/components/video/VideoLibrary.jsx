import { formatBytes, formatDuration } from '../../lib/format.js'

export default function VideoLibrary({ videos, selectedId, onSelect, loading, error }) {
  if (loading) {
    return <p className="text-sm text-neutral-500">Loading video sources…</p>
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>
  }

  if (videos.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No videos found in <code className="text-xs">data/challenge_videos/</code>.
      </p>
    )
  }

  return (
    <ul className="space-y-1.5">
      {videos.map((video) => {
        const active = video.id === selectedId
        return (
          <li key={video.id}>
            <button
              type="button"
              onClick={() => onSelect(video.id)}
              title={video.filename}
              className={`w-full border px-3 py-2 text-left text-sm transition-colors ${
                active ? 'border-ink bg-neutral-100' : 'border-line bg-white hover:bg-neutral-50'
              }`}
            >
              <div className="truncate font-medium text-ink">{video.filename}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500">
                <span>{formatDuration(video.metadata.duration)}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {video.metadata.width}×{video.metadata.height}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatBytes(video.file_size)}</span>
              </div>
              {video.duplicate_of && (
                <div className="mt-1.5 inline-block border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                  Duplicate content
                </div>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
