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
  const [showTrends, setShowTrends] = useState(false)

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
      {/* Clean, Human-Focused Header & Action Hub */}
      <section className="border border-line bg-surface p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <p className="mb-2 flex items-center gap-2 text-label font-medium text-ink-soft">
              <span className="h-2 w-2 rounded-full bg-signal" />
              Warehouse Safety Decision Intelligence
            </p>
            <h1 className="font-display text-display-lg font-bold text-ink">
              See what&apos;s about to go wrong. Know what to do instead.
            </h1>
            <p className="mt-2 text-small text-ink-soft">
              TRACE continuously monitors warehouse camera feeds to detect unstable loads, explain physical tipping risks, and give workers immediate safe placement instructions before damage occurs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigateTo('Live View')}
              className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2 text-small font-semibold text-paper shadow-sm transition-colors hover:bg-ink-soft"
            >
              Watch Live Cameras
              <ArrowRight size={15} />
            </button>
            <button
              type="button"
              onClick={() => navigateTo('Incidents')}
              className="inline-flex items-center gap-2 border border-line bg-paper px-3.5 py-2 text-small font-medium text-ink transition-colors hover:border-line-strong"
            >
              Active Hazards ({events.length})
            </button>
            <button
              type="button"
              onClick={() => navigateTo('What-If Simulation')}
              className="inline-flex items-center gap-2 border border-line bg-paper px-3.5 py-2 text-small font-medium text-ink transition-colors hover:border-line-strong"
            >
              <FlaskConical size={15} />
              What-If Simulator
            </button>
            <a
              href={incidentsCsvUrl()}
              className="inline-flex items-center gap-1.5 border border-line bg-paper px-3 py-2 text-caption font-medium text-ink-soft transition-colors hover:text-ink"
              title="Download full incident audit log in CSV format"
            >
              <Download size={14} />
              Export CSV
            </a>
            <a
              href={shiftSummaryMdUrl()}
              className="inline-flex items-center gap-1.5 border border-line bg-paper px-3 py-2 text-caption font-medium text-ink-soft transition-colors hover:text-ink"
              title="Printable shift safety report"
            >
              <Download size={14} />
              Shift Report
            </a>
          </div>
        </div>
      </section>

      {error && (
        <div className="border border-danger bg-danger/5 p-4 font-mono text-caption text-danger">
          [error] {error}
        </div>
      )}

      {/* 4 Clean, Human-Understandable Warehouse Safety Metrics */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-line bg-surface p-5 transition-colors hover:border-line-strong">
          <span className="text-label font-medium uppercase tracking-wider text-ink-faint">
            Monitored Camera Bays
          </span>
          <p className="mt-2 font-display text-display-lg font-bold tabular-nums text-ink">
            {activeFeedsCount} <span className="text-title font-medium text-ink-soft">Bays</span>
          </p>
          <p className="mt-1 text-caption text-ink-soft">
            Live coverage across loading docks, staging zones, and narrow aisles
          </p>
        </div>

        <div className="border border-ok/40 bg-ok/5 p-5 transition-colors hover:border-ok">
          <span className="text-label font-medium uppercase tracking-wider text-ok">
            Verified Damage Prevented
          </span>
          <p className="mt-2 font-display text-display-lg font-bold tabular-nums text-ok">
            {preventedDisplay} <span className="text-title font-medium text-ok/80">Prevented</span>
          </p>
          <p className="mt-1 text-caption text-ink-soft">
            Event #75: load corrected before release (18 outcomes awaiting review)
          </p>
        </div>

        <div className="border border-line bg-surface p-5 transition-colors hover:border-line-strong">
          <span className="text-label font-medium uppercase tracking-wider text-ink-faint">
            Active Hazard Findings
          </span>
          <p className="mt-2 font-display text-display-lg font-bold tabular-nums text-ink">
            {events.length}{' '}
            <span className="text-title font-medium text-signal">
              ({(severityCounts.Critical || 0) + (severityCounts.High || 0)} High)
            </span>
          </p>
          <p className="mt-1 text-caption text-ink-soft">
            Evidence-backed physical risks (overhangs, unstable stacks, blindspots)
          </p>
        </div>

        <div className="border border-line bg-surface p-5 transition-colors hover:border-line-strong">
          <span className="text-label font-medium uppercase tracking-wider text-ink-faint">
            Worker Privacy & Ethics
          </span>
          <p className="mt-2 font-display text-display-lg font-bold tabular-nums text-ink">
            100% <span className="text-title font-medium text-ink-soft">Redacted</span>
          </p>
          <p className="mt-1 text-caption text-ink-soft">
            Personnel faces obscured by default; zero individual worker blame
          </p>
        </div>
      </section>

      {/* How TRACE Protects Workers — Clean 4-Step Operational Flow */}
      <section className="border border-line bg-surface p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-display-sm font-semibold text-ink">
            How TRACE Prevents Warehouse Damage
          </h2>
          <span className="text-caption text-ink-faint">
            Autonomous decision intelligence loop
          </span>
        </div>
        <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-4">
          <div className="bg-paper p-4">
            <span className="font-mono text-label font-bold text-signal">STEP 01</span>
            <h3 className="mt-1 text-small font-bold text-ink">Spot the Hazard</h3>
            <p className="mt-1 text-caption text-ink-soft">
              Cameras detect overhanging cartons, leaning stacks, or workers entering hazardous machine zones.
            </p>
          </div>
          <div className="bg-paper p-4">
            <span className="font-mono text-label font-bold text-signal">STEP 02</span>
            <h3 className="mt-1 text-small font-bold text-ink">Evaluate Physics</h3>
            <p className="mt-1 text-caption text-ink-soft">
              Calculates tipping-moment risk, center-of-gravity offset, and cargo crushing danger in real time.
            </p>
          </div>
          <div className="bg-paper p-4">
            <span className="font-mono text-label font-bold text-signal">STEP 03</span>
            <h3 className="mt-1 text-small font-bold text-ink">Guide Safe Action</h3>
            <p className="mt-1 text-caption text-ink-soft">
              Provides the worker with immediate, clear guidance (e.g. push box back 15cm, rotate 90°) with voice alerts.
            </p>
          </div>
          <div className="bg-ink p-4 text-paper">
            <span className="font-mono text-label font-bold text-signal">STEP 04</span>
            <h3 className="mt-1 text-small font-bold text-paper">Verify Resolution</h3>
            <p className="mt-1 text-caption text-paper/80">
              Analyzes follow-up video to verify the hazard was cleared before classifying as safely prevented.
            </p>
          </div>
        </div>
      </section>

      {/* Active Hazards Section */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <div>
            <h2 className="font-display text-display-sm font-semibold text-ink">
              Recent Safety Hazards Requiring Attention
            </h2>
            <p className="text-caption text-ink-soft">
              Detected by warehouse vision sensors — review and verify corrective action
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigateTo('Incidents')}
            className="inline-flex items-center gap-1.5 border border-line bg-paper px-3 py-1.5 text-small font-medium text-ink transition-colors hover:border-line-strong"
          >
            View All Incidents ({events.length})
            <ArrowRight size={14} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 border border-line bg-surface p-6 text-small text-ink-soft">
            <span className="h-4 w-4 animate-spin motion-reduce:animate-none border-2 border-ink border-t-transparent" />
            Loading incident stream…
          </div>
        ) : events.length === 0 ? (
          <div className="border border-line bg-surface p-6 text-small text-ink-soft">
            No incidents recorded. All monitored areas nominal.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {recentDistinctIncidents.slice(0, 4).map((ev) => {
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
                <div key={ev.event_id} className="flex flex-col gap-3 border border-line bg-surface p-5 transition-colors hover:border-line-strong">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`border px-2 py-0.5 text-label font-bold uppercase tracking-wider ${
                          BAND_STYLE[severity] || BAND_STYLE.Low
                        }`}
                      >
                        {severity} Risk
                      </span>
                      <span className="text-caption font-medium text-ink-soft">{videoInfo.cameraName}</span>
                    </div>
                    <span className="font-mono text-caption font-semibold tabular-nums text-ink">
                      {formatTimestamp(ev.timestamp)}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-title font-bold leading-tight text-ink">{title}</h3>
                    <p className="mt-1 text-small text-ink-soft">{whyItMatters}</p>
                  </div>

                  {action && (
                    <div className="rounded border-l-2 border-ok bg-ok/5 px-3 py-2 text-small text-ink">
                      <span className="block text-label font-bold uppercase tracking-wider text-ok">
                        Safe Action Required
                      </span>
                      {action}
                    </div>
                  )}

                  <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
                    <span className="text-caption text-ink-faint">{videoInfo.zone || videoInfo.scenarioTitle}</span>
                    <button
                      type="button"
                      onClick={() => handleLaunchIncident(ev)}
                      className="inline-flex items-center gap-1.5 border border-ink bg-ink px-3 py-1.5 text-caption font-semibold text-paper transition-colors hover:bg-ink-soft"
                    >
                      Replay & Verify
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Warehouse Safety Trends & Coaching (Collapsible to preserve calm UI) */}
      <section className="border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-display-sm font-semibold text-ink">
              Warehouse Safety Trends & Coaching Focus
            </h2>
            <p className="text-caption text-ink-soft">
              Recurring hazard patterns and supervisor coaching priorities across camera bays
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowTrends(!showTrends)}
            className="border border-line bg-paper px-3.5 py-1.5 text-small font-medium text-ink transition-colors hover:border-line-strong"
          >
            {showTrends ? 'Hide Trends' : 'View Safety Trends & Heatmap'}
          </button>
        </div>
        {showTrends && (
          <div className="mt-6 border-t border-line pt-6">
            <LearningInsights />
          </div>
        )}
      </section>
    </div>
  )
}
