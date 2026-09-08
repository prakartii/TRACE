import { formatBytes, formatDuration } from '../../lib/format.js'

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-1.5 text-small last:border-b-0">
      <span className="text-ink-soft">{label}</span>
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
    return <p className="text-small text-ink-soft">Select a video to see its metadata.</p>
  }

  const { metadata } = video

  return (
    <div>
      <h2 className="mb-2 truncate text-title font-medium text-ink" title={video.filename}>
        {video.filename}
      </h2>
      <div>
        <Row label="duration" value={formatDuration(metadata.duration)} />
        <Row label="resolution" value={`${metadata.width} × ${metadata.height}`} />
        <Row label="source frame rate" value={`${metadata.fps.toFixed(1)} fps`} />
        {samplingPolicy && (
          <Row
            label="adaptive analysis rate"
            value={
              <span className="flex items-center gap-1.5">
                <span className="font-mono">{samplingPolicy.analysis_fps} fps</span>
                <span className="border border-line bg-paper px-1.5 py-0.5 font-mono text-label text-ink-soft">
                  {samplingPolicy.sampling_mode === 'motion_dense' ? 'motion-dense' : 'normal'}
                </span>
              </span>
            }
          />
        )}
        <Row label="frame count" value={metadata.frame_count ?? 'unknown'} />
        <Row label="codec" value={metadata.codec ?? 'unknown'} />
        <Row label="audio track" value={audioLabel(metadata.has_audio)} />
        <Row label="file size" value={formatBytes(video.file_size)} />
        <Row label="source id" value={<span className="font-mono text-caption">{video.id}</span>} />
      </div>

      {samplingPolicy?.rationale && (
        <div className="mt-3 border border-line bg-paper p-2.5">
          <div className="text-caption font-medium text-ink">adaptive temporal policy</div>
          <div className="mt-0.5 text-caption leading-relaxed text-ink-soft">
            {samplingPolicy.rationale}
          </div>
        </div>
      )}

      {video.duplicate_of && (
        <p className="mt-3 border border-signal/40 bg-signal/10 px-2 py-1.5 text-small text-[#8a5f00]">
          Byte-identical duplicate of another source video (id {video.duplicate_of}).
        </p>
      )}

      <p className="mt-3 text-small leading-relaxed text-ink-soft">
        Perception evaluates frames at the adaptive analysis rate. Use the pilot model toggle to
        detect boxes and pallets alongside persons, enabling the spatial graph and
        counter-proposal generation.
      </p>
    </div>
  )
}
