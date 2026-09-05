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

export default function MetadataPanel({ video }) {
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
        <Row label="Frame rate" value={`${metadata.fps.toFixed(1)} fps`} />
        <Row label="Frame count" value={metadata.frame_count ?? 'unknown'} />
        <Row label="Codec" value={metadata.codec ?? 'unknown'} />
        <Row label="Audio track" value={audioLabel(metadata.has_audio)} />
        <Row label="File size" value={formatBytes(video.file_size)} />
        <Row label="Source ID" value={video.id} />
      </div>

      {video.duplicate_of && (
        <p className="mt-3 border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
          Byte-identical duplicate of another source video (id {video.duplicate_of}).
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        The optional overlays (above) show real person detection + tracking from a
        pretrained model, and a world model that derives spatial relationships
        (proximity/contact/support) from that — it does not yet detect boxes, pallets,
        or trolleys, and there is no risk scoring, hazard classification, or planner
        output. See{' '}
        <code className="text-[11px]">docs/VIDEO_AUDIT.md</code> for what this footage
        actually contains.
      </p>
    </div>
  )
}
