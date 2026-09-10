import { ArrowRight } from 'lucide-react'
import { formatBytes, formatDuration } from '../../lib/format.js'
import { getVideoScenarioInfo } from '../../lib/scenarios.js'
import { useLiveViewContext } from '../../LiveViewContext.jsx'

const RISK_BADGES = {
  Critical: 'border-danger/40 bg-danger/10 text-danger',
  High: 'border-signal/40 bg-signal/10 text-[#8a5f00]',
  Medium: 'border-steel/40 bg-steel/10 text-steel',
  Low: 'border-line-strong bg-paper text-ink-soft',
}

export default function VideoLibrary({ videos = [], selectedId, onSelect, loading, error }) {
  const { navigateTo } = useLiveViewContext()

  if (loading) {
    return (
      <div className="border border-line bg-surface p-4 font-mono text-caption text-ink-soft">
        loading video sources…
      </div>
    )
  }

  if (error) {
    return <div className="border border-danger bg-danger/5 p-3 text-small text-danger">{error}</div>
  }

  const canonicalVideos = videos.filter((v) => !v.duplicate_of)

  if (canonicalVideos.length === 0) {
    return (
      <p className="text-small text-ink-soft">
        No camera feeds available.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1 text-label text-ink-faint">
        <span className="font-semibold uppercase tracking-wider">Switch Camera</span>
        <span className="font-mono">{canonicalVideos.length} online</span>
      </div>

      <ul className="flex flex-col gap-2">
        {canonicalVideos.map((video) => {
          const active = video.id === selectedId
          const info = getVideoScenarioInfo(video.id || video.filename)
          const badgeStyle = RISK_BADGES[info.riskBand] || RISK_BADGES.High
          const frameCount = video.metadata.frame_count || Math.round(video.metadata.duration * (video.metadata.fps || 10))

          return (
            <li key={video.id}>
              <div
                className={`flex flex-col gap-2 border p-3 text-left transition-colors ${
                  active ? 'border-ink bg-surface' : 'border-line bg-surface hover:border-line-strong'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="block text-small font-semibold leading-snug text-ink">
                      {info.scenarioTitle}
                    </span>
                    <span className="text-caption text-ink-soft">{info.cameraName}</span>
                  </div>
                  <span className={`shrink-0 border px-1.5 py-0.5 text-label font-medium ${badgeStyle}`}>
                    {info.riskBand || 'High'} risk
                  </span>
                </div>

                <p className="line-clamp-2 text-caption text-ink-soft">{info.primaryRisk}</p>

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelect(video.id)}
                    className={`border px-2.5 py-1 text-caption font-medium transition-colors cursor-pointer ${
                      active
                        ? 'border-ink bg-ink text-paper font-semibold'
                        : 'border-line bg-paper text-ink hover:border-ink'
                    }`}
                  >
                    {active ? 'Active Feed' : 'Select Bay'}
                  </button>

                  <button
                    type="button"
                    onClick={() => navigateTo('Incident Replay', { videoId: video.id })}
                    className="inline-flex items-center gap-1 text-caption font-medium text-ink-soft hover:text-ink hover:underline cursor-pointer"
                  >
                    Evidence Replay
                    <ArrowRight size={12} />
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
