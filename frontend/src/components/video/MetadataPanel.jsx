import { formatBytes, formatDuration } from '../../lib/format.js'

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-1.5 text-xs last:border-b-0">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  )
}

function audioLabel(hasAudio) {
  if (hasAudio === null || hasAudio === undefined) return 'unknown'
  return hasAudio ? 'yes' : 'no'
}

export default function MetadataPanel({ video, samplingPolicy }) {
  if (!video) {
    return <p className="text-sm text-neutral-500">Select a video to see its metadata.</p>
  }

  const { metadata } = video

  return (
    <div>
      <h2 className="mb-2 truncate text-sm font-medium text-ink" title={video.filename}>
        {video.filename}
      </h2>
      <div>
        <Row label="Duration" value={formatDuration(metadata.duration)} />
        <Row label="Resolution" value={`${metadata.width} × ${metadata.height}`} />
        <Row label="Source frame rate" value={`${metadata.fps.toFixed(1)} fps`} />
        {samplingPolicy && (
          <Row
            label="Adaptive analysis rate"
            value={
              <span className="flex items-center gap-1.5">
                <span className="font-mono font-semibold">{samplingPolicy.analysis_fps} fps</span>
                <span
                  className={`px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-wider rounded uppercase ${
                    samplingPolicy.sampling_mode === 'motion_dense'
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      : 'bg-neutral-100 text-neutral-700 border border-line'
                  }`}
                >
                  {samplingPolicy.sampling_mode === 'motion_dense' ? 'MOTION-DENSE' : 'NORMAL'}
                </span>
              </span>
            }
          />
        )}
        <Row label="Frame count" value={metadata.frame_count ?? 'unknown'} />
        <Row label="Codec" value={metadata.codec ?? 'unknown'} />
        <Row label="Audio track" value={audioLabel(metadata.has_audio)} />
        <Row label="File size" value={formatBytes(video.file_size)} />
        <Row label="Source ID" value={video.id} />
      </div>

      {samplingPolicy?.rationale && (
        <div className="mt-3 border border-neutral-200 bg-neutral-50 p-2.5 text-xs">
          <div className="font-semibold text-neutral-800 mb-0.5">
            Adaptive Temporal Policy
          </div>
          <div className="text-neutral-600 leading-relaxed text-[11px]">
            {samplingPolicy.rationale}
          </div>
        </div>
      )}

      {video.duplicate_of && (
        <p className="mt-3 border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
          Byte-identical duplicate of another source video (id {video.duplicate_of}).
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        Perception pipeline evaluates frames at the adaptive analysis rate. Use the
        Pilot Model toggle to detect boxes and pallets alongside persons, enabling
        multi-object spatial graph evaluation and counter-proposal generation.
      </p>
    </div>
  )
}
