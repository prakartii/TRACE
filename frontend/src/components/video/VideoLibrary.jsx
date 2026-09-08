import { formatBytes, formatDuration } from '../../lib/format.js'
import { getVideoScenarioInfo } from '../../lib/scenarios.js'
import { useLiveViewContext } from '../../LiveViewContext.jsx'

const RISK_BADGES = {
  Critical: 'border-red-400 bg-red-50 text-red-800',
  High: 'border-orange-300 bg-orange-50 text-orange-800',
  Medium: 'border-amber-300 bg-amber-50 text-amber-800',
  Low: 'border-neutral-300 bg-neutral-50 text-neutral-700',
}

export default function VideoLibrary({ videos = [], selectedId, onSelect, loading, error }) {
  const { navigateTo } = useLiveViewContext()

  if (loading) {
    return (
      <div className="border border-line bg-white p-4 text-center">
        <p className="text-xs text-neutral-500 font-mono">Loading 7 canonical video sources…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-red-300 bg-red-50 p-3 text-xs text-red-700">
        {error}
      </div>
    )
  }

  // Defensively ensure exactly canonical distinct videos are displayed
  const canonicalVideos = videos.filter((v) => !v.duplicate_of)

  if (canonicalVideos.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No videos found in <code className="text-xs">data/challenge_videos/</code>.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between px-1 text-[11px] text-neutral-500">
        <span>7 Monitored Camera Feeds</span>
        <span className="font-mono">{canonicalVideos.length} distinct scenarios</span>
      </div>

      <ul className="space-y-2">
        {canonicalVideos.map((video) => {
          const active = video.id === selectedId
          const info = getVideoScenarioInfo(video.id || video.filename)
          const badgeStyle = RISK_BADGES[info.riskBand] || RISK_BADGES.High
          const frameCount = video.metadata.frame_count || Math.round(video.metadata.duration * (video.metadata.fps || 10))

          return (
            <li key={video.id}>
              <div
                className={`border p-3 text-left text-xs transition-all flex flex-col gap-2 ${
                  active
                    ? 'border-neutral-900 bg-neutral-50/80 shadow-xs ring-1 ring-neutral-900'
                    : 'border-line bg-white hover:border-neutral-400'
                }`}
              >
                {/* Header: Scenario Title & Severity */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-bold text-neutral-950 text-xs leading-snug">
                      {info.scenarioTitle}
                    </span>
                    <span className="text-[10px] text-neutral-500 font-medium">
                      {info.cameraName}
                    </span>
                  </div>
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase border shrink-0 ${badgeStyle}`}>
                    {info.riskBand || 'High'} Risk
                  </span>
                </div>

                {/* Primary Risk Description */}
                <p className="text-[11px] text-neutral-600 leading-snug line-clamp-2">
                  {info.primaryRisk}
                </p>

                {/* Metadata details */}
                <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 font-mono pt-1 border-t border-line/60">
                  <span>{formatDuration(video.metadata.duration)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{frameCount} frames</span>
                  <span aria-hidden="true">·</span>
                  <span>{video.metadata.width}×{video.metadata.height}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatBytes(video.file_size)}</span>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onSelect(video.id)}
                    className={`px-2.5 py-1 text-[11px] font-bold border transition-colors cursor-pointer ${
                      active
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100'
                    }`}
                  >
                    {active ? '● Selected Feed' : 'Inspect Feed'}
                  </button>

                  <button
                    type="button"
                    onClick={() => navigateTo('Incident Replay', { videoId: video.id })}
                    className="text-[11px] font-bold text-neutral-700 hover:text-black flex items-center gap-1 underline cursor-pointer"
                  >
                    <span>Replay Incidents</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
