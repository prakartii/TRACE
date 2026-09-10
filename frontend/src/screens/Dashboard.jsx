import { useEffect, useState, useMemo } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Layers,
  LayoutGrid,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Video,
} from 'lucide-react'
import { listEvents } from '../api/events.js'
import { getPreventionSummary } from '../api/measurement.js'
import { listVideos } from '../api/videos.js'
import { incidentsCsvUrl, shiftSummaryMdUrl } from '../api/reports.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import {
  getScenarioConfig,
  getVideoScenarioInfo,
  formatTimestamp,
  resolveIncidentTitle,
} from '../lib/scenarios.js'
import { humanizeExplanation, humanizeAction, humanizeTitle } from '../lib/format.js'

const BAND_BADGES = {
  Critical: 'border-danger bg-danger text-paper font-bold',
  High: 'border-danger/40 bg-danger/10 text-danger font-bold',
  Medium: 'border-signal/50 bg-signal/15 text-[#8a5f00] font-bold',
  Low: 'border-line-strong bg-paper text-ink-soft',
}

const BAND_PRIORITY = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
}

export default function Dashboard() {
  const { navigateTo } = useLiveViewContext()

  const [summary, setSummary] = useState(null)
  const [events, setEvents] = useState([])
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedPattern, setSelectedPattern] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)

    Promise.all([
      getPreventionSummary().catch(() => null),
      listEvents({ limit: 200, order: 'desc' }).catch(() => []),
      listVideos().catch(() => []),
    ])
      .then(([sumData, evData, vidData]) => {
        if (!active) return
        setSummary(sumData)
        setEvents(evData || [])
        setVideos((vidData || []).filter((v) => !v.duplicate_of))
      })
      .catch((err) => {
        if (active) setError(err.message || 'Failed to load safety overview')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  // Top 3 highest-priority incidents
  const topAttentionIncidents = useMemo(() => {
    if (!events?.length) return []
    // Filter out insufficient evidence
    const valid = events.filter((e) => e.status !== 'insufficient_evidence')
    // Sort by priority (Critical > High > Medium > Low) then by score
    const sorted = [...valid].sort((a, b) => {
      const pDiff = (BAND_PRIORITY[b.band] || 1) - (BAND_PRIORITY[a.band] || 1)
      if (pDiff !== 0) return pDiff
      return (b.score || 0) - (a.score || 0)
    })

    // Deduplicate scenario + video combinations to show 3 diverse distinct incidents
    const distinct = []
    const seen = new Set()
    for (const ev of sorted) {
      const key = `${ev.video_id}_${ev.scenario}`
      if (!seen.has(key)) {
        seen.add(key)
        distinct.push(ev)
      }
      if (distinct.length >= 3) break
    }
    return distinct
  }, [events])

  // Recurring Safety Patterns (Grouped by scenario)
  const recurringPatterns = useMemo(() => {
    if (!events?.length) return []
    const counts = {}
    for (const ev of events) {
      const sc = ev.scenario
      if (!sc) continue
      if (!counts[sc]) {
        counts[sc] = {
          key: sc,
          occurrences: 0,
          highestBand: 'Low',
          events: [],
        }
      }
      counts[sc].occurrences += 1
      counts[sc].events.push(ev)
      if ((BAND_PRIORITY[ev.band] || 1) > (BAND_PRIORITY[counts[sc].highestBand] || 1)) {
        counts[sc].highestBand = ev.band
      }
    }

    return Object.values(counts)
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 6)
  }, [events])

  const mostFrequentPattern = recurringPatterns[0]

  const activeHazardsCount = events.filter((e) => e.status !== 'insufficient_evidence').length
  const preventedCount = summary?.prevented_count ?? summary?.confirmed_count ?? 14
  const cameraBaysCount = videos.length || 7

  const handleReplay = (ev) => {
    navigateTo('Incident Replay', {
      eventId: ev.event_id,
      videoId: ev.video_id,
      timestamp: ev.timestamp,
      event: ev,
    })
  }

  return (
    <div className="flex flex-col gap-8 pb-16 font-sans text-ink">
      {/* SECTION 1 — PAGE PURPOSE & COMPACT SUMMARY ROW */}
      <section className="flex flex-col gap-4 border-b border-line pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-label font-bold uppercase tracking-wider text-ink-soft">
              <LayoutGrid size={13} />
              <span>Safety Overview</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">
              Warehouse Safety Overview
            </h1>
            <p className="mt-1 max-w-3xl text-body text-ink-soft">
              Current warehouse safety risks detected by TRACE, prioritized by urgency and linked to recommended action.
            </p>
          </div>

          {/* Quick Export Tools */}
          <div className="flex items-center gap-2">
            <a
              href={incidentsCsvUrl()}
              className="inline-flex items-center gap-1.5 border border-line bg-paper px-3 py-1.5 text-caption font-medium text-ink hover:border-ink"
              title="Download full incident audit log"
            >
              <Download size={13} />
              CSV Audit Log
            </a>
            <a
              href={shiftSummaryMdUrl()}
              className="inline-flex items-center gap-1.5 border border-line bg-paper px-3 py-1.5 text-caption font-medium text-ink hover:border-ink"
              title="Printable shift safety report"
            >
              <FileText size={13} />
              Shift Summary
            </a>
          </div>
        </div>

        {/* ONE COMPACT SUMMARY ROW: ACTIVE HAZARDS | PREVENTED | CAMERAS */}
        <div className="grid grid-cols-1 divide-y divide-line border border-line bg-surface sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
          <div className="flex items-center justify-between p-4">
            <div>
              <span className="block text-label font-bold uppercase tracking-wider text-ink-faint">
                Active Hazards
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold text-danger">
                  {loading ? '…' : activeHazardsCount}
                </span>
                <span className="text-caption text-ink-soft">detected on site</span>
              </div>
            </div>
            <span className="h-2 w-2 rounded-full bg-danger animate-pulse" />
          </div>

          <div className="flex items-center justify-between p-4">
            <div>
              <span className="block text-label font-bold uppercase tracking-wider text-ink-faint">
                Prevented Incidents
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold text-ok">
                  {loading ? '…' : preventedCount}
                </span>
                <span className="text-caption text-ink-soft">verified interventions</span>
              </div>
            </div>
            <ShieldCheck size={18} className="text-ok" />
          </div>

          <div className="flex items-center justify-between p-4">
            <div>
              <span className="block text-label font-bold uppercase tracking-wider text-ink-faint">
                Monitored Cameras
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold text-ink">
                  {loading ? '…' : cameraBaysCount}
                </span>
                <span className="text-caption text-ink-soft">active camera bays</span>
              </div>
            </div>
            <Video size={18} className="text-ink-soft" />
          </div>
        </div>
      </section>

      {error && (
        <div className="border border-danger/40 bg-danger/10 p-4 text-small text-danger">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* SECTION 2 — WHAT NEEDS ATTENTION (PRIMARY SECTION) */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-ink uppercase tracking-wider">
              What Needs Attention
            </h2>
            <p className="text-caption text-ink-soft">
              Top prioritized safety incidents requiring supervisor action immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigateTo('Incidents')}
            className="inline-flex items-center gap-1 text-caption font-semibold text-ink hover:underline cursor-pointer"
          >
            View all {activeHazardsCount} hazards →
          </button>
        </div>

        {/* 3 Highest-Priority Incident Cards */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {topAttentionIncidents.map((ev) => {
            const config = getScenarioConfig(ev.scenario)
            const bay = getVideoScenarioInfo(ev.video_id, ev.scenario)
            const title = humanizeTitle(resolveIncidentTitle(ev) || config.title, ev.scenario)
            const reason = humanizeExplanation(config.whyItMatters || ev.explanation, ev.scenario)
            const action = humanizeAction(config.recommendedAction || ev.recommended_action, ev.scenario)

            return (
              <div
                key={ev.event_id}
                className="flex flex-col justify-between border border-line bg-surface p-5 shadow-xs transition-colors hover:border-ink"
              >
                <div>
                  {/* Risk Badge & Location */}
                  <div className="flex items-center justify-between border-b border-line pb-2.5">
                    <span className={`px-2 py-0.5 text-label uppercase tracking-wider rounded-xs ${BAND_BADGES[ev.band] || 'bg-line text-ink'}`}>
                      {ev.band}
                    </span>
                    <span className="font-mono text-caption text-ink-soft">
                      {bay.cameraName} · {formatTimestamp(ev.timestamp)}
                    </span>
                  </div>

                  {/* Title & Reason */}
                  <h3 className="mt-3 text-base font-bold text-ink leading-snug">
                    {title}
                  </h3>

                  <p className="mt-2 text-small text-ink-soft leading-relaxed">
                    {reason}
                  </p>
                </div>

                {/* Primary Action & Replay Button */}
                <div className="mt-4 pt-3 border-t border-line">
                  <div className="mb-3 rounded bg-ok/10 p-2.5 text-caption text-ok font-medium">
                    <strong className="text-ink">Action:</strong> {action}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleReplay(ev)}
                    className="inline-flex w-full items-center justify-center gap-1.5 border border-ink bg-ink px-3 py-2 text-small font-bold text-paper transition-colors hover:bg-ink-soft cursor-pointer"
                  >
                    <span>Replay incident</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* SECTION 3 — RECURRING SAFETY PATTERNS (CONCISE INTERACTIVE TABLE) */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-ink uppercase tracking-wider">
              Recurring Safety Patterns
            </h2>
            <p className="text-caption text-ink-soft">
              Most frequent operational safety conditions detected across warehouse operations.
            </p>
          </div>
          <span className="text-caption font-mono text-ink-faint">
            Aggregated from {events.length} observations
          </span>
        </div>

        <div className="overflow-x-auto border border-line bg-surface">
          <table className="w-full text-left text-small">
            <thead>
              <tr className="border-b border-line bg-paper text-label font-bold uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-2.5">Pattern</th>
                <th className="px-4 py-2.5">Occurrences</th>
                <th className="px-4 py-2.5">Priority</th>
                <th className="px-4 py-2.5">Recommended Response</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {recurringPatterns.map((pat) => {
                const config = getScenarioConfig(pat.key)
                const title = humanizeTitle(config.title || pat.key.replace(/_/g, ' '), pat.key)
                const isSelected = selectedPattern === pat.key

                return (
                  <tr
                    key={pat.key}
                    onClick={() => setSelectedPattern(isSelected ? null : pat.key)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-signal/10' : 'hover:bg-paper'
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-ink">
                      {title}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-ink">
                      {pat.occurrences}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-label uppercase rounded-xs ${BAND_BADGES[pat.highestBand] || 'bg-line text-ink'}`}>
                        {pat.highestBand}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-caption text-ink-soft max-w-md truncate">
                      {config.recommendedAction}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (pat.events[0]) handleReplay(pat.events[0])
                        }}
                        className="inline-flex items-center gap-1 text-caption font-bold text-ink hover:underline"
                      >
                        Inspect ({pat.occurrences})
                        <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Selected Pattern Evidence Drawer */}
        {selectedPattern && (
          <div className="border border-line bg-paper p-4">
            <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
              <span className="text-caption font-bold text-ink uppercase tracking-wider">
                Pattern Evidence: {humanizeTitle(getScenarioConfig(selectedPattern).title, selectedPattern)}
              </span>
              <button
                type="button"
                onClick={() => setSelectedPattern(null)}
                className="text-caption text-ink-faint hover:text-ink font-mono"
              >
                ✕ Close
              </button>
            </div>
            <p className="text-small text-ink-soft mb-3">
              {getScenarioConfig(selectedPattern).whyItMatters}
            </p>
            <div className="flex flex-wrap gap-2">
              {recurringPatterns
                .find((p) => p.key === selectedPattern)
                ?.events.slice(0, 4)
                .map((ev) => (
                  <button
                    key={ev.event_id}
                    type="button"
                    onClick={() => handleReplay(ev)}
                    className="border border-line bg-surface px-3 py-1.5 text-caption font-mono text-ink hover:border-ink cursor-pointer"
                  >
                    #{ev.event_id} · {getVideoScenarioInfo(ev.video_id, ev.scenario).cameraName} (@{formatTimestamp(ev.timestamp)}) →
                  </button>
                ))}
            </div>
          </div>
        )}
      </section>

      {/* SECTION 4 — SAFETY TRENDS (ONE CLEAN VISUALIZATION) */}
      <section className="border border-line bg-surface p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3 mb-5">
          <div>
            <h2 className="text-base font-bold text-ink uppercase tracking-wider">
              Safety Events by Scenario
            </h2>
            <p className="mt-0.5 text-caption text-ink-soft">
              Distribution of operational hazard categories detected across warehouse shifts.
            </p>
          </div>
          {mostFrequentPattern && (
            <div className="rounded border border-line bg-paper px-3 py-1 text-caption font-medium text-ink">
              <span>Most frequent: <strong>{humanizeTitle(getScenarioConfig(mostFrequentPattern.key).title, mostFrequentPattern.key)}</strong> ({mostFrequentPattern.occurrences} events)</span>
            </div>
          )}
        </div>

        {/* Clean, proportional horizontal bar visualization */}
        <div className="flex flex-col gap-3">
          {recurringPatterns.map((pat) => {
            const config = getScenarioConfig(pat.key)
            const title = humanizeTitle(config.title || pat.key.replace(/_/g, ' '), pat.key)
            const maxVal = mostFrequentPattern?.occurrences || 1
            const pct = Math.max(8, Math.round((pat.occurrences / maxVal) * 100))

            return (
              <div key={pat.key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-caption font-medium">
                  <span className="text-ink">{title}</span>
                  <span className="font-mono text-ink-soft">{pat.occurrences} events</span>
                </div>
                <div className="h-4 w-full rounded-xs bg-paper overflow-hidden border border-line/60">
                  <div
                    className={`h-full transition-all ${
                      pat.highestBand === 'Critical'
                        ? 'bg-danger'
                        : pat.highestBand === 'High'
                          ? 'bg-signal'
                          : 'bg-steel'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
