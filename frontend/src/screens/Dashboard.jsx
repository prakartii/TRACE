import { useEffect, useState, useMemo } from 'react'
import { ArrowRight, ArrowUpRight, Crosshair, Download, FlaskConical } from 'lucide-react'
import { listEvents } from '../api/events.js'
import { getPreventionSummary } from '../api/measurement.js'
import { listVideos } from '../api/videos.js'
import LearningInsights from '../components/LearningInsights.jsx'
import { incidentsCsvUrl, shiftSummaryMdUrl } from '../api/reports.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import {
  getScenarioConfig,
  getVideoScenarioInfo,
  CANONICAL_SCENARIO_VIDEOS,
  DEMO_PRESETS,
  formatTimestamp,
  resolveIncidentTitle,
} from '../lib/scenarios.js'
import { humanizeExplanation } from '../lib/format.js'

const BAND_STYLE = {
  Critical: 'border-danger/40 bg-danger/10 text-danger',
  High: 'border-signal/40 bg-signal/10 text-[#8a5f00]',
  Medium: 'border-steel/40 bg-steel/10 text-steel',
  Low: 'border-line-strong bg-paper text-ink-soft',
}

const PIPELINE = [
  { n: '01', verb: 'detect', q: 'what happened', detail: 'observed across camera zones' },
  { n: '02', verb: 'explain', q: 'why it is dangerous', detail: 'inferred tipping and load mechanics' },
  { n: '03', verb: 'recommend', q: 'what to do now', detail: 'a safe corrective action' },
  { n: '04', verb: 'simulate', q: 'what if we act', detail: 'a counterfactual placement test' },
  { n: '05', verb: 'verify', q: 'did it resolve', detail: 'post-action video confirmation' },
]

export default function Dashboard() {
  const { navigateTo } = useLiveViewContext()

  const [summary, setSummary] = useState(null)
  const [events, setEvents] = useState([])
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)

    Promise.all([
      getPreventionSummary().catch(() => null),
      listEvents({ limit: 40, order: 'desc' }).catch(() => []),
      listVideos().catch(() => []),
    ])
      .then(([sumData, evData, vidData]) => {
        if (!active) return
        setSummary(sumData)
        setEvents(evData || [])
        const canonical = (vidData || []).filter((v) => !v.duplicate_of)
        setVideos(canonical)
      })
      .catch((err) => {
        if (active) setError(err.message || 'Failed to load dashboard metrics')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const handleLaunchIncident = (ev) => {
    navigateTo('Incident Replay', {
      eventId: ev.event_id,
      videoId: ev.video_id,
      timestamp: ev.timestamp,
      event: ev,
    })
  }

  const handleLaunchPreset = (preset) => {
    navigateTo('Incident Replay', {
      eventId: preset.id,
      videoId: preset.videoId,
      timestamp: preset.timestamp,
    })
  }

  const recentDistinctIncidents = useMemo(() => {
    if (!events?.length) return []
    const seen = new Set()
    const distinct = []
    for (const ev of events) {
      const key = `${ev.video_id}_${ev.scenario}`
      if (!seen.has(key)) {
        seen.add(key)
        distinct.push(ev)
      }
      if (distinct.length >= 6) break
    }
    if (distinct.length < 6) {
      for (const ev of events) {
        if (!distinct.some((d) => d.event_id === ev.event_id)) {
          distinct.push(ev)
        }
        if (distinct.length >= 6) break
      }
    }
    return distinct
  }, [events])

  const severityCounts = events.reduce(
    (acc, ev) => {
      const b = ev.band || 'Medium'
      acc[b] = (acc[b] || 0) + 1
      return acc
    },
    { Critical: 0, High: 0, Medium: 0, Low: 0 }
  )

  const activeFeedsCount = videos.length
  const distinctScenarioCount = new Set(events.map((e) => e.scenario).filter(Boolean)).size
  const preventedDisplay =
    summary?.prevented_count != null ? summary.prevented_count : loading ? '…' : '—'

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* hero — asymmetric */}
      <section className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <p className="mb-3 flex items-center gap-2 text-label font-medium text-ink-soft">
            <span className="h-2 w-2 bg-signal" />
            warehouse safety decision intelligence
          </p>
          <h1 className="font-display text-display-xl font-semibold text-ink">
            See what&apos;s about to go wrong.
            <br />
            Know what to do instead.
          </h1>
          <p className="mt-4 max-w-xl text-body text-ink-soft">
            TRACE reads warehouse video, explains the physical hazard behind a risky
            placement, recommends a safer alternative before the worker touches the load,
            then verifies the outcome on later footage.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigateTo('Incidents')}
              className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2 text-small font-semibold text-paper transition-colors hover:bg-ink-soft"
            >
              explore incidents
              <ArrowRight size={15} />
            </button>
            <button
              type="button"
              onClick={() => navigateTo('Scenario Coverage')}
              className="inline-flex items-center gap-2 border border-line bg-surface px-4 py-2 text-small font-medium text-ink transition-colors hover:border-line-strong"
            >
              <Crosshair size={15} />
              14-scenario coverage
            </button>
            <button
              type="button"
              onClick={() => navigateTo('What-If Simulation')}
              className="inline-flex items-center gap-2 border border-line bg-surface px-4 py-2 text-small font-medium text-ink transition-colors hover:border-line-strong"
            >
              <FlaskConical size={15} />
              what-if simulator
            </button>
            <a
              href={incidentsCsvUrl()}
              className="inline-flex items-center gap-2 border border-line bg-surface px-4 py-2 text-small font-medium text-ink transition-colors hover:border-line-strong"
            >
              <Download size={15} />
              incidents CSV
            </a>
            <a
              href={shiftSummaryMdUrl()}
              className="inline-flex items-center gap-2 border border-line bg-surface px-4 py-2 text-small font-medium text-ink transition-colors hover:border-line-strong"
            >
              <Download size={15} />
              shift summary
            </a>
          </div>
        </div>

        {/* status board */}
        <div className="lg:col-span-4">
          <div className="border border-ink bg-surface">
            <div className="h-1 bg-[repeating-linear-gradient(45deg,#1A1712_0_10px,#C28208_10px_20px)]" />
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <span className="text-label font-medium text-ink-faint">
                live overview
              </span>
              <span className="font-mono text-caption text-ink-faint">shift 07</span>
            </div>
            <dl className="divide-y divide-line">
              <div className="flex items-baseline justify-between px-4 py-3">
                <dt className="text-small text-ink-soft">monitored feeds</dt>
                <dd className="font-display text-display-md font-semibold tabular-nums text-ink">
                  {activeFeedsCount}
                </dd>
              </div>
              <div className="flex items-baseline justify-between px-4 py-3">
                <dt className="text-small text-ink-soft">hazards prevented</dt>
                <dd className="font-display text-display-md font-semibold tabular-nums text-ok">
                  {preventedDisplay}
                </dd>
              </div>
              <div className="flex items-baseline justify-between px-4 py-3">
                <dt className="text-small text-ink-soft">recent incidents</dt>
                <dd className="font-display text-display-md font-semibold tabular-nums text-ink">
                  {loading ? '…' : events.length}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {error && (
        <div className="border border-danger bg-danger/5 p-4 font-mono text-caption text-danger">
          [error] {error}
        </div>
      )}

      {/* decision pipeline — a real sequence, numbered */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-display-md font-semibold text-ink">
            How TRACE closes the loop
          </h2>
          <span className="font-mono text-caption text-ink-faint">
            detect → explain → recommend → simulate → verify
          </span>
        </div>
        <ol className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-5">
          {PIPELINE.map((step, i) => (
            <li
              key={step.n}
              className={`bg-surface p-4 ${i === PIPELINE.length - 1 ? 'bg-ink text-paper' : ''}`}
            >
              <span
                className={`font-display text-display-md font-semibold ${
                  i === PIPELINE.length - 1 ? 'text-signal' : 'text-ink-faint'
                }`}
              >
                {step.n}
              </span>
              <p
                className={`mt-1 text-small font-semibold ${
                  i === PIPELINE.length - 1 ? 'text-paper' : 'text-ink'
                }`}
              >
                {step.verb}
              </p>
              <p
                className={`mt-0.5 text-caption ${
                  i === PIPELINE.length - 1 ? 'text-paper/70' : 'text-ink-soft'
                }`}
              >
                {step.q} — {step.detail}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* KPI bento — asymmetric spans */}
      <section>
        <h2 className="mb-3 font-display text-display-md font-semibold text-ink">
          Shift at a glance
        </h2>
        <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-6">
          <div className="bg-surface p-5 sm:col-span-3">
            <span className="text-label font-medium text-ink-faint">
              incident severity
            </span>
            <div className="mt-3 flex items-end gap-3">
              {(['Critical', 'High', 'Medium', 'Low']).map((b) => (
                <div key={b} className="flex flex-col items-center gap-1">
                  <span
                    className={`h-16 w-9 border ${
                      BAND_STYLE[b]?.split(' ')[0] || 'border-line'
                    } ${BAND_STYLE[b]?.split(' ')[1] || 'bg-paper'}`}
                    style={{ height: `${(severityCounts[b] || 1) * 12 + 12}px` }}
                  />
                  <span className="text-label text-ink-soft">{b}</span>
                  <span className="font-display text-title font-semibold tabular-nums text-ink">
                    {severityCounts[b] || 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-surface p-5 sm:col-span-2">
            <span className="text-label font-medium text-ink-faint">
              scenario coverage
            </span>
            <p className="mt-2 font-display text-display-lg font-semibold tabular-nums text-ink">
              {loading ? '…' : distinctScenarioCount}
              <span className="text-title"> / 14</span>
            </p>
            <p className="mt-1 text-caption text-ink-soft">
              distinct scenario types present in the current log
            </p>
          </div>
          <div className="bg-surface p-5 sm:col-span-1">
            <span className="text-label font-medium text-ink-faint">
              verified
            </span>
            <p className="mt-2 font-display text-display-lg font-semibold tabular-nums text-ok">
              {preventedDisplay}
            </p>
            <p className="mt-1 text-caption text-ink-soft">prevented, on video</p>
          </div>
        </div>
      </section>

      {/* monitored zones */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-display-md font-semibold text-ink">
            Monitored warehouse zones
          </h2>
          <button
            type="button"
            onClick={() => navigateTo('Scenario Coverage')}
            className="inline-flex items-center gap-1 text-small font-medium text-ink-soft transition-colors hover:text-ink"
          >
            view the 14-scenario matrix
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(CANONICAL_SCENARIO_VIDEOS).map(([id, info], i) => (
            <div
              key={id}
              className={`group bg-surface p-4 ${
                i === 3 ? 'xl:col-span-1' : ''
              } transition-colors hover:bg-paper`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`border px-2 py-0.5 text-label font-medium ${
                    BAND_STYLE[info.riskBand] || BAND_STYLE.High
                  }`}
                >
                  {info.riskBand} risk
                </span>
                <span className="font-mono text-caption text-ink-faint">{info.duration}</span>
              </div>
              <h3 className="mt-3 text-small font-semibold leading-snug text-ink">
                {info.scenarioTitle}
              </h3>
              <p className="text-caption text-ink-soft">{info.cameraName}</p>
              <p className="mt-2 line-clamp-2 text-caption text-ink-soft">{info.description}</p>
              <button
                type="button"
                onClick={() => navigateTo('Incident Replay', { videoId: id })}
                className="mt-3 inline-flex items-center gap-1 text-small font-medium text-ink underline-offset-2 hover:underline"
              >
                replay incidents
                <ArrowUpRight size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* recommended demos */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-display-md font-semibold text-ink">
            Recommended demonstrations
          </h2>
          <span className="text-caption text-ink-faint">
            one click jumps to the recorded moment
          </span>
        </div>
        <div className="grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-3">
          {DEMO_PRESETS.map((preset, i) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleLaunchPreset(preset)}
              className={`group flex flex-col gap-2 bg-surface p-4 text-left transition-colors hover:bg-paper ${
                i === 0 ? 'border-l-2 border-signal' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-caption font-semibold text-ink">
                  event #{preset.id}
                </span>
                <span className="font-mono text-caption text-ink-faint">
                  {preset.timestamp.toFixed(1)}s
                </span>
              </div>
              <p className="text-small font-semibold text-ink">{preset.tag}</p>
              <p className="text-caption text-ink-soft">{preset.desc}</p>
              <span className="inline-flex items-center gap-1 text-caption font-medium text-ink-soft group-hover:text-ink">
                replay incident
                <ArrowRight size={13} />
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* recent incidents */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-display-md font-semibold text-ink">
            Recent safety incidents
          </h2>
          <button
            type="button"
            onClick={() => navigateTo('Incidents')}
            className="inline-flex items-center gap-1 text-small font-medium text-ink-soft transition-colors hover:text-ink"
          >
            view all incidents ({events.length})
            <ArrowRight size={14} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 border border-line bg-surface p-6 text-small text-ink-soft">
            <span className="h-4 w-4 animate-spin motion-reduce:animate-none border-2 border-ink border-t-transparent" />
            loading incident stream…
          </div>
        ) : events.length === 0 ? (
          <div className="border border-line bg-surface p-6 text-small text-ink-soft">
            No incidents recorded yet. Open the live view to start monitoring challenge videos.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-2">
            {recentDistinctIncidents.map((ev) => {
              const config = getScenarioConfig(ev.scenario)
              const videoInfo = getVideoScenarioInfo(ev.video_id)
              const severity = ev.band || config.defaultBand || 'Medium'
              const title = resolveIncidentTitle(ev) || config.title || 'Safety condition'
              const action =
                ev.planner_recommendation?.action || ev.recommended_action || config.recommendedAction
              const whyItMatters = humanizeExplanation(
                ev.explanation || ev.planner_recommendation?.rationale || config.whyItMatters,
                ev.scenario,
                ev.entity_id
              )

              return (
                <div key={ev.event_id} className="flex flex-col gap-3 bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`border px-2 py-0.5 text-label font-medium ${
                          BAND_STYLE[severity] || BAND_STYLE.Low
                        }`}
                      >
                        {severity} risk
                      </span>
                      <span className="text-caption text-ink-soft">{videoInfo.cameraName}</span>
                    </div>
                    <span className="font-mono text-caption font-semibold tabular-nums text-ink">
                      {formatTimestamp(ev.timestamp)}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-title font-semibold leading-tight text-ink">{title}</h3>
                    <p className="mt-1 line-clamp-2 text-small text-ink-soft">{whyItMatters}</p>
                  </div>

                  {action && (
                    <div className="border-l-2 border-ok bg-ok/5 px-3 py-2 text-small text-ink">
                      <span className="block text-label font-medium text-ok">
                        recommended action
                      </span>
                      {action}
                    </div>
                  )}

                  <div className="mt-auto flex items-center justify-between border-t border-line pt-2">
                    <span className="text-caption text-ink-faint">{videoInfo.scenarioTitle}</span>
                    <button
                      type="button"
                      onClick={() => handleLaunchIncident(ev)}
                      className="inline-flex items-center gap-1.5 border border-ink bg-ink px-3 py-1 text-caption font-semibold text-paper transition-colors hover:bg-ink-soft"
                    >
                      view incident
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <LearningInsights />
    </div>
  )
}
