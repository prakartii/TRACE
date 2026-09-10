import { getFindingPriorityScore } from './FindingsPanel.jsx'
import {
  getScenarioConfig,
  getVideoScenarioInfo,
  STATUS_STYLES,
  RISK_BAND_STYLES,
  EPISTEMIC_LEVELS,
} from '../../lib/scenarios.js'

function formatTime(sec) {
  if (typeof sec !== 'number' || isNaN(sec)) return '00:00.0'
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1)
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`
}

export default function LiveAnalysisSummary({ video, findings, loading, findingsEnabled, currentTime }) {
  const videoInfo = video ? getVideoScenarioInfo(video.id || video.filename) : null

  const header = (statusNode) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
      <div>
        <h3 className="text-title font-semibold text-ink">Live Camera Analysis</h3>
        <p className="mt-0.5 text-caption text-ink-soft">
          {videoInfo ? (
            <>
              Camera: <span className="font-semibold text-ink">{videoInfo.cameraName}</span>
              {currentTime !== undefined && (
                <> · Time: <span className="font-mono tabular-nums">{formatTime(currentTime)}</span></>
              )}
            </>
          ) : (
            'Continuous real-time safety monitoring across warehouse camera feeds.'
          )}
        </p>
      </div>
      {statusNode}
    </div>
  )

  if (!video) {
    return (
      <div className="mb-4 border border-line bg-surface p-4">
        {header(<span className="border border-line bg-paper px-2 py-0.5 text-label text-ink-soft">standby</span>)}
        <p className="mt-3 text-small text-ink-soft">
          Select a warehouse video source from the library to begin live operational evaluation.
        </p>
      </div>
    )
  }

  if (!findingsEnabled) {
    return (
      <div className="mb-4 border border-line bg-surface p-4">
        {header(<span className="border border-signal/40 bg-signal/10 px-2 py-0.5 text-label text-[#8a5f00]">findings paused</span>)}
        <div className="mt-3 grid grid-cols-1 gap-4 text-small md:grid-cols-2">
          <div>
            <span className="block text-label font-medium text-ink-faint">current status</span>
            <p className="mt-1 font-medium text-ink">Video loaded, risk lenses in standby.</p>
          </div>
          <div>
            <span className="block text-label font-medium text-ink-faint">operator action</span>
            <p className="mt-1 font-medium text-ink">Enable multi-lens risk evaluation below to resume.</p>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="mb-4 border border-line bg-surface p-4">
        {header(
          <span className="flex items-center gap-1.5 border border-signal/40 bg-signal/10 px-2 py-0.5 text-label text-[#8a5f00]">
            <span className="h-1.5 w-1.5 animate-pulse motion-reduce:animate-none bg-signal" />
            evaluating…
          </span>
        )}
        <p className="mt-3 text-small text-ink-soft">
          Analyzing camera frames for imminent warehouse safety hazards…
        </p>
      </div>
    )
  }

  if (!findings || findings.length === 0) {
    return (
      <div className="mb-4 border border-ok/40 bg-ok/5 p-4">
        {header(<span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-semibold text-ok uppercase">all clear</span>)}
        <div className="mt-3 grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-4">
          <Cell label="what is happening" value="Normal warehouse handling detected." note="No active safety hazards observed." />
          <Cell label="why it matters" value="All tracked items and personnel remain in safe operating zones." />
          <Cell label="what to do now" value="Continue standard workflow." note="Maintain standard aisle and staging clearances." />
          <Cell label="how TRACE knows" value="Continuous multi-frame camera verification is nominal." />
        </div>
      </div>
    )
  }

  const sorted = [...findings].sort((a, b) => getFindingPriorityScore(b) - getFindingPriorityScore(a))
  const primary = sorted[0]
  const plan = primary.planner_recommendation
  const config = getScenarioConfig(primary.scenario)
  const statusMeta = STATUS_STYLES[primary.status] || STATUS_STYLES.insufficient_evidence
  const band = primary.band || config.defaultBand || 'Medium'
  const bandStyle = RISK_BAND_STYLES[band] || RISK_BAND_STYLES.Medium
  const epistemicMeta = EPISTEMIC_LEVELS[primary.epistemic_level] || EPISTEMIC_LEVELS.INFERRED

  const displayTitle = plan?.risk_title || config.title || primary.scenario?.replace(/_/g, ' ') || 'Observed condition'
  const displayWhy = plan?.rationale || config.whyItMatters
  const displayAction = plan?.action || primary.recommended_action || config.recommendedAction

  return (
    <div className="mb-4 border border-line bg-surface p-4">
      {header(
        <div className="flex flex-wrap items-center gap-2">
          <span className={`border px-2 py-0.5 text-label font-medium ${bandStyle.subtle}`}>
            {bandStyle.label}
          </span>
          <span className={`border px-2 py-0.5 text-label font-medium ${statusMeta.style}`}>
            {statusMeta.label}
          </span>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-4">
        <div className="flex flex-col justify-between bg-paper p-3">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-label font-medium text-ink-faint">1. what is happening</span>
              {findings.length > 1 && (
                <span className="bg-line px-1.5 py-0.5 text-label text-ink-soft">+{findings.length - 1} more</span>
              )}
            </div>
            <p className="text-small font-semibold leading-snug text-ink">{displayTitle}</p>
            {primary.explanation && (
              <p className="mt-1 line-clamp-3 text-caption text-ink-soft" title={primary.explanation}>
                {primary.explanation}
              </p>
            )}
          </div>
          <span className="mt-2 block text-label text-ink-faint">
            {videoInfo?.cameraName || 'Warehouse Floor'}
          </span>
        </div>

        <div className="flex flex-col justify-between bg-paper p-3">
          <div>
            <span className="block text-label font-medium text-ink-faint">2. why it matters</span>
            <p className="mt-1 text-caption text-ink-soft">{displayWhy}</p>
          </div>
          <span className="mt-2 block text-label text-ink-faint">Operational Consequence</span>
        </div>

        <div
          className={`flex flex-col justify-between p-3 ${
            primary.status === 'supported'
              ? 'bg-ok/10'
              : primary.status === 'probable'
                ? 'bg-signal/10'
                : 'bg-paper'
          }`}
        >
          <div>
            <span className="block text-label font-medium text-ink-faint">3. what to do now</span>
            <p className="mt-1 text-small font-semibold leading-snug text-ink">"{displayAction}"</p>
          </div>
          {plan?.what_if_eligible && (
            <span className="mt-2 block text-label font-medium text-ok">what-if simulation available</span>
          )}
        </div>

        <div className="flex flex-col justify-between bg-paper p-3">
          <div>
            <span className="block text-label font-medium text-ink-faint">4. how TRACE knows</span>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`border px-1.5 py-0.5 text-label font-semibold ${bandStyle.subtle}`}>
                {band} Risk
              </span>
              {primary.confidence && (
                <span className="text-caption text-ink-soft">Certainty: {primary.confidence}</span>
              )}
            </div>
            <p className="mt-1 text-caption text-ink-soft">
              Verified across consecutive video frames
            </p>
          </div>
          <span className="mt-2 block text-label text-ink-faint">Visual Evidence Verified</span>
        </div>
      </div>
    </div>
  )
}

function Cell({ label, value, note }) {
  return (
    <div className="flex flex-col justify-between bg-paper p-3">
      <div>
        <span className="block text-label font-medium text-ink-faint">{label}</span>
        <p className="mt-1 text-small font-semibold leading-snug text-ink">{value}</p>
        {note && <p className="mt-1 text-caption text-ink-soft">{note}</p>}
      </div>
    </div>
  )
}
