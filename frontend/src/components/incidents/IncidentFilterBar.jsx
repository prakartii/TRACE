import { Download } from 'lucide-react'
import { incidentsCsvUrl } from '../../api/reports.js'

const LENSES = ['structural', 'behaviour', 'conformance', 'environmental']
const BANDS = ['Critical', 'High', 'Medium', 'Low']
const STATUSES = ['supported', 'probable', 'insufficient_evidence', 'unsupported']
const REVIEW = [
  ['', 'all'],
  ['unreviewed', 'unreviewed'],
  ['reviewed', 'reviewed'],
  ['false_positive', 'false positive'],
  ['confirmed_damage', 'confirmed damage'],
  ['unresolved', 'unresolved'],
]

// One place maps the review dropdown to the API's `reviewed` / `review_status`
// pair — the list query and the CSV export both read this, so they cannot drift.
export function toApiFilters({ lens, band, status, videoId, review }) {
  const f = {}
  if (lens) f.lens = lens
  if (band) f.band = band
  if (status) f.status = status
  if (videoId) f.videoId = videoId
  if (review === 'unreviewed') f.reviewed = false
  else if (review === 'reviewed') f.reviewed = true
  else if (review) f.reviewStatus = review
  return f
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex items-center gap-1.5 text-caption text-dim">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-line-strong bg-bg px-1.5 py-1 text-caption text-ink focus:border-ink"
      >
        {options.map((o) => {
          const [v, t] = Array.isArray(o) ? o : [o, o]
          return (
            <option key={v} value={v}>
              {t}
            </option>
          )
        })}
      </select>
    </label>
  )
}

export default function IncidentFilterBar({ value, onChange, videos, activeFilters }) {
  const set = (patch) => onChange({ ...value, ...patch })
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Select label="lens" value={value.lens} onChange={(v) => set({ lens: v })} options={[['', 'all'], ...LENSES]} />
      <Select label="band" value={value.band} onChange={(v) => set({ band: v })} options={[['', 'all'], ...BANDS]} />
      <Select label="status" value={value.status} onChange={(v) => set({ status: v })} options={[['', 'all'], ...STATUSES]} />
      <Select label="review" value={value.review} onChange={(v) => set({ review: v })} options={REVIEW} />
      <Select
        label="camera"
        value={value.videoId}
        onChange={(v) => set({ videoId: v })}
        options={[['', 'all'], ...videos.map((vid) => [vid.id, vid.filename])]}
      />
      <a
        href={incidentsCsvUrl(activeFilters)}
        className="ml-auto inline-flex items-center gap-1.5 text-caption text-dim hover:text-ink"
      >
        <Download size={13} />
        export CSV{Object.keys(activeFilters).length ? ' (filtered)' : ''}
      </a>
    </div>
  )
}
