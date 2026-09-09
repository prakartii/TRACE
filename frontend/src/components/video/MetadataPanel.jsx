import { formatBytes, formatDuration } from '../../lib/format.js'
import { getVideoScenarioInfo } from '../../lib/scenarios.js'

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-1 text-caption last:border-b-0">
      <span className="text-ink-soft">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  )
}

export default function MetadataPanel({ video, samplingPolicy }) {
  if (!video) {
    return <p className="text-small text-ink-soft">Select a camera to see feed details.</p>
  }

  const { metadata } = video
  const info = getVideoScenarioInfo(video.id || video.filename)

  return (
    <div>
      <div className="mb-2.5 border-b border-line pb-2">
        <h2 className="text-small font-bold text-ink">{info.cameraName}</h2>
        <p className="text-caption text-ink-soft">{info.scenarioTitle}</p>
      </div>
      <div>
        <Row label="Camera Zone" value={info.zone || 'Warehouse Floor'} />
        <Row label="Feed Length" value={formatDuration(metadata.duration)} />
        <Row label="Stream Quality" value={`${metadata.width} × ${metadata.height}`} />
        <Row label="Frame Rate" value={`${metadata.fps ? metadata.fps.toFixed(0) : 30} fps`} />
        {samplingPolicy && (
          <Row
            label="Analysis Mode"
            value={
              <span className="font-mono text-[11px] text-ink-soft">
                {samplingPolicy.analysis_fps} fps ({samplingPolicy.sampling_mode === 'motion_dense' ? 'motion-dense' : 'adaptive'})
              </span>
            }
          />
        )}
      </div>
    </div>
  )
}
