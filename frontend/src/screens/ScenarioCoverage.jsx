import { useState, useMemo } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Eye,
  Filter,
  Layers,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Video,
  X,
} from 'lucide-react'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import {
  CANONICAL_14_SCENARIOS,
  CANONICAL_VIDEO_MAPPINGS,
  RISK_BAND_STYLES,
} from '../lib/scenarios.js'

const LENSES = ['ALL', 'Structural', 'Behaviour', 'Conformance', 'Environmental']

const LENS_BADGES = {
  Structural: 'border-blue-300 bg-blue-50 text-blue-800',
  Behaviour: 'border-purple-300 bg-purple-50 text-purple-800',
  Conformance: 'border-amber-300 bg-amber-50 text-amber-800',
  Environmental: 'border-emerald-300 bg-emerald-50 text-emerald-800',
}

const SEVERITY_BADGES = {
  Critical: 'border-danger/40 bg-danger/10 text-danger font-semibold',
  High: 'border-signal/40 bg-signal/15 text-[#8a5f00] font-semibold',
  Medium: 'border-steel/30 bg-surface text-ink-soft font-medium',
  Low: 'border-line bg-paper text-ink-faint',
}

export default function ScenarioCoverage() {
  const { navigateTo } = useLiveViewContext()
  const [viewMode, setViewMode] = useState('rules') // 'rules' | 'cameras'
  const [selectedLens, setSelectedLens] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState(1) // Default first expanded

  const lensCounts = useMemo(() => {
    const counts = { ALL: CANONICAL_14_SCENARIOS.length }
    CANONICAL_14_SCENARIOS.forEach((scen) => {
      counts[scen.lens] = (counts[scen.lens] || 0) + 1
    })
    return counts
  }, [])

  const filteredScenarios = useMemo(() => {
    return CANONICAL_14_SCENARIOS.filter((scen) => {
      if (selectedLens !== 'ALL' && scen.lens.toLowerCase() !== selectedLens.toLowerCase()) {
        return false
      }
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        scen.title.toLowerCase().includes(q) ||
        scen.lens.toLowerCase().includes(q) ||
        scen.riskTitle.toLowerCase().includes(q) ||
        scen.observed.toLowerCase().includes(q) ||
        scen.inferred.toLowerCase().includes(q) ||
        scen.recommendedAction.toLowerCase().includes(q) ||
        (scen.videoName && scen.videoName.toLowerCase().includes(q))
      )
    })
  }, [selectedLens, searchQuery])

  const toggleExpand = (num) => {
    setExpandedId((prev) => (prev === num ? null : num))
  }

  const handleReplay = (item, e) => {
    if (e) e.stopPropagation()
    if (!item.videoId) return
    navigateTo('Incident Replay', {
      eventId: item.presetId || null,
      videoId: item.videoId,
      timestamp: item.timestamp || 0,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* SECTION 1: Header & Page Purpose */}
      <section className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-2 text-label font-medium uppercase tracking-wider text-ink-soft">
            <Crosshair size={13} />
            <span>Safety Specification &amp; Detection Catalog</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-ink">
            Safety Rules &amp; Catalog
          </h1>
          <p className="mt-1 text-body text-ink-soft max-w-2xl">
            Explore TRACE’s 14 safety detection rules across structural, behavioural, conformance, and environmental risk lenses.
          </p>
        </div>

        {/* View Switcher: Rules Table vs Camera Mappings */}
        <div className="flex items-center border border-line bg-surface p-1">
          <button
            type="button"
            onClick={() => setViewMode('rules')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-small font-medium transition-colors ${
              viewMode === 'rules'
                ? 'bg-paper text-ink shadow-sm border border-line'
                : 'text-ink-soft hover:text-ink'
            }`}
          >
            <SlidersHorizontal size={13} />
            <span>Detection Rules ({CANONICAL_14_SCENARIOS.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('cameras')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-small font-medium transition-colors ${
              viewMode === 'cameras'
                ? 'bg-paper text-ink shadow-sm border border-line'
                : 'text-ink-soft hover:text-ink'
            }`}
          >
            <Layers size={13} />
            <span>Camera Mappings ({CANONICAL_VIDEO_MAPPINGS.length})</span>
          </button>
        </div>
      </section>

      {/* VIEW 1: RULES TABLE (Dense, scannable, filterable) */}
      {viewMode === 'rules' && (
        <section className="flex flex-col gap-4">
          {/* Controls: Lens Filter Tabs + Search Input */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-surface border border-line p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-label font-medium text-ink-faint mr-1 flex items-center gap-1">
                <Filter size={12} />
                LENS:
              </span>
              {LENSES.map((lens) => {
                const count = lensCounts[lens] || 0
                const isSelected = selectedLens === lens
                return (
                  <button
                    key={lens}
                    type="button"
                    onClick={() => setSelectedLens(lens)}
                    className={`px-2.5 py-1 text-label font-medium border transition-colors ${
                      isSelected
                        ? 'border-ink bg-ink text-paper font-semibold'
                        : 'border-line bg-paper text-ink-soft hover:text-ink hover:border-ink-soft'
                    }`}
                  >
                    {lens === 'ALL' ? 'All Rules' : lens} ({count})
                  </button>
                )
              })}
            </div>

            {/* Keyword Search */}
            <div className="relative min-w-[240px] max-w-sm flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search rules, keywords, triggers..."
                className="w-full border border-line bg-paper pl-8 pr-7 py-1 text-small text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="border border-line bg-paper overflow-hidden">
            {filteredScenarios.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-body font-medium text-ink">No safety rules match your filters.</p>
                <p className="mt-1 text-small text-ink-soft">
                  Try clearing your search query or selecting &ldquo;All Rules&rdquo;.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedLens('ALL')
                    setSearchQuery('')
                  }}
                  className="mt-3 border border-line bg-surface px-3 py-1 text-small font-medium text-ink hover:bg-paper"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-surface text-label font-medium uppercase tracking-wider text-ink-soft">
                      <th className="py-2.5 px-3 w-32">Rule &amp; Lens</th>
                      <th className="py-2.5 px-3 min-w-[260px]">Scenario &amp; Trigger</th>
                      <th className="py-2.5 px-3 w-28">Severity</th>
                      <th className="py-2.5 px-3 min-w-[220px]">TRACE Response</th>
                      <th className="py-2.5 px-3 w-36">Evidence</th>
                      <th className="py-2.5 px-3 w-28">Status</th>
                      <th className="py-2.5 px-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line text-small">
                    {filteredScenarios.map((scen) => {
                      const isExpanded = expandedId === scen.number
                      const isDemonstrated = scen.status === 'DEMONSTRATED'
                      const lensBadgeClass = LENS_BADGES[scen.lens] || 'border-line bg-surface text-ink'
                      const severityClass = SEVERITY_BADGES[scen.band] || 'border-line bg-surface text-ink-soft'

                      return (
                        <tr
                          key={scen.number}
                          onClick={() => toggleExpand(scen.number)}
                          className={`cursor-pointer transition-colors ${
                            isExpanded ? 'bg-surface/80' : 'hover:bg-surface/40'
                          }`}
                        >
                          <td colSpan={7} className="p-0">
                            {/* Primary Row Content */}
                            <div className="flex items-center w-full py-3 px-3">
                              {/* Rule & Lens */}
                              <div className="w-32 shrink-0 pr-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-caption font-bold text-ink-faint">
                                    #{String(scen.number).padStart(2, '0')}
                                  </span>
                                  <span className={`border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${lensBadgeClass}`}>
                                    {scen.lens}
                                  </span>
                                </div>
                              </div>

                              {/* Scenario & Trigger */}
                              <div className="min-w-[260px] flex-1 pr-3">
                                <h2 className="text-small font-semibold text-ink leading-tight">
                                  {scen.title}
                                </h2>
                                <p className="text-caption text-ink-soft line-clamp-1 mt-0.5">
                                  {scen.riskTitle}
                                </p>
                              </div>

                              {/* Severity */}
                              <div className="w-28 shrink-0 pr-3">
                                <span className={`inline-block border px-2 py-0.5 text-label ${severityClass}`}>
                                  {scen.band.toUpperCase()}
                                </span>
                              </div>

                              {/* TRACE Response */}
                              <div className="min-w-[220px] flex-1 pr-3">
                                <p className="text-caption text-ink line-clamp-1">
                                  {scen.recommendedAction}
                                </p>
                              </div>

                              {/* Evidence */}
                              <div className="w-36 shrink-0 pr-3">
                                {isDemonstrated ? (
                                  <button
                                    type="button"
                                    onClick={(e) => handleReplay(scen, e)}
                                    className="inline-flex items-center gap-1 text-caption font-semibold text-ink hover:underline group"
                                  >
                                    <span>{scen.videoTag}</span>
                                    <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
                                  </button>
                                ) : (
                                  <span className="text-caption text-ink-faint font-mono">
                                    Rule-ready
                                  </span>
                                )}
                              </div>

                              {/* Status */}
                              <div className="w-28 shrink-0 pr-2">
                                {isDemonstrated ? (
                                  <span className="inline-flex items-center gap-1.5 text-caption font-medium text-ok">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                                    Active
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 text-caption text-ink-soft">
                                    <span className="h-1.5 w-1.5 rounded-full bg-line" />
                                    Standby
                                  </span>
                                )}
                              </div>

                              {/* Expand Chevron */}
                              <div className="w-10 shrink-0 text-right pr-1 text-ink-soft">
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </div>
                            </div>

                            {/* Expanded Detail Drawer (Inline 4-part breakdown) */}
                            {isExpanded && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="border-t border-b border-line bg-surface p-4 cursor-default animate-in fade-in duration-150"
                              >
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                                  {/* 1. What TRACE looks for */}
                                  <div className="border border-line bg-paper p-3.5 flex flex-col justify-between">
                                    <div>
                                      <div className="text-label font-medium uppercase tracking-wider text-ink-faint">
                                        Perception Trigger
                                      </div>
                                      <div className="mt-1 text-small font-semibold text-ink">
                                        What TRACE Looks For
                                      </div>
                                      <p className="mt-2 text-caption text-ink-soft leading-relaxed">
                                        {scen.observed}
                                      </p>
                                    </div>
                                    <div className="mt-3 pt-2 border-t border-line/60 flex items-center justify-between text-[11px] text-ink-faint">
                                      <span>Epistemic mode:</span>
                                      <span className="font-mono font-medium text-ink">{scen.epistemicLevel}</span>
                                    </div>
                                  </div>

                                  {/* 2. Why it matters */}
                                  <div className="border border-line bg-paper p-3.5 flex flex-col justify-between">
                                    <div>
                                      <div className="text-label font-medium uppercase tracking-wider text-ink-faint">
                                        Safety Impact
                                      </div>
                                      <div className="mt-1 text-small font-semibold text-ink">
                                        Why It Matters
                                      </div>
                                      <p className="mt-2 text-caption text-ink-soft leading-relaxed">
                                        {scen.inferred}
                                      </p>
                                    </div>
                                    <div className="mt-3 pt-2 border-t border-line/60 flex items-center justify-between text-[11px] text-ink-faint">
                                      <span>Hazard type:</span>
                                      <span className="font-medium text-ink truncate max-w-[120px]">{scen.riskTitle}</span>
                                    </div>
                                  </div>

                                  {/* 3. Recommended response */}
                                  <div className="border border-line bg-paper p-3.5 flex flex-col justify-between">
                                    <div>
                                      <div className="text-label font-medium uppercase tracking-wider text-ink-faint">
                                        Supervisor Action
                                      </div>
                                      <div className="mt-1 text-small font-semibold text-ink">
                                        Recommended Response
                                      </div>
                                      <p className="mt-2 text-caption text-ink leading-relaxed">
                                        {scen.recommendedAction}
                                      </p>
                                    </div>
                                    <div className="mt-3 pt-2 border-t border-line/60">
                                      {scen.whatIfEligible ? (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ok">
                                          <Check size={11} /> What-If simulation available
                                        </span>
                                      ) : (
                                        <span className="text-[11px] text-ink-faint">
                                          Direct procedural intervention
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* 4. Optical Evidence & Replay */}
                                  <div className="border border-line bg-paper p-3.5 flex flex-col justify-between">
                                    <div>
                                      <div className="text-label font-medium uppercase tracking-wider text-ink-faint">
                                        Optical Evidence
                                      </div>
                                      <div className="mt-1 text-small font-semibold text-ink">
                                        {isDemonstrated ? scen.videoTag : 'Specification Only'}
                                      </div>
                                      <p className="mt-1 text-caption text-ink-soft">
                                        {isDemonstrated ? scen.videoName : 'Configured rule active across all zones.'}
                                      </p>
                                      {scen.timestamp && (
                                        <div className="mt-2 font-mono text-caption text-ink-faint">
                                          Timestamp: t = {scen.timestamp.toFixed(1)}s
                                        </div>
                                      )}
                                      {scen.secondaryVideo && (
                                        <p className="mt-1 text-[11px] text-ink-faint">
                                          Also detected in: {scen.secondaryVideo}
                                        </p>
                                      )}
                                    </div>
                                    <div className="mt-3 pt-2 border-t border-line/60">
                                      {isDemonstrated ? (
                                        <button
                                          type="button"
                                          onClick={(e) => handleReplay(scen, e)}
                                          className="w-full flex items-center justify-center gap-1.5 bg-ink py-1.5 px-3 text-caption font-semibold text-paper hover:bg-ink-soft transition-colors"
                                        >
                                          <Video size={13} />
                                          <span>Replay incident in {scen.videoTag}</span>
                                          <ArrowUpRight size={13} />
                                        </button>
                                      ) : (
                                        <span className="block text-center text-caption text-ink-faint py-1 border border-line bg-surface">
                                          No live violation in footage
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* VIEW 2: CAMERA MAPPINGS (7 Canonical Cameras with multi-scenario findings) */}
      {viewMode === 'cameras' && (
        <section className="flex flex-col gap-4">
          <div className="border border-line bg-surface p-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-title font-semibold text-ink">
                Warehouse Camera Multi-Hazard Mappings
              </h2>
              <p className="text-small text-ink-soft">
                Demonstrates how a single camera perspective generates multiple independent operational safety findings.
              </p>
            </div>
            <span className="font-mono text-caption text-ink-faint">
              7 Active Fixed Feeds
            </span>
          </div>

          <div className="flex flex-col gap-4">
            {CANONICAL_VIDEO_MAPPINGS.map((vid) => (
              <div key={vid.videoId} className="border border-line bg-paper">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface p-3.5">
                  <div className="flex items-center gap-2.5">
                    <span className="bg-ink px-2 py-0.5 font-mono text-label font-bold text-paper">
                      {vid.tag}
                    </span>
                    <h2 className="text-small font-bold text-ink">{vid.cameraName}</h2>
                    <span className="text-caption text-ink-soft">· {vid.zone}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-caption text-ink-faint">{vid.duration}</span>
                    <span className="border border-line bg-paper px-2 py-0.5 text-label font-medium text-ink-soft">
                      {vid.scenarios.length} findings
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-px bg-line md:grid-cols-3">
                  {vid.scenarios.map((scen) => (
                    <div key={scen.key} className="flex flex-col justify-between bg-paper p-3.5 gap-2.5">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-caption text-ink-faint font-semibold">
                            Rule #{scen.number}
                          </span>
                          <span className="border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-soft uppercase font-medium">
                            {scen.lens}
                          </span>
                        </div>
                        <h3 className="mt-1 text-small font-semibold text-ink leading-tight">
                          {scen.title}
                        </h3>
                        <p className="mt-1 text-caption text-ink-soft line-clamp-2">
                          {scen.summary}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-line flex items-center justify-between">
                        <span className="font-mono text-caption text-ink-faint">
                          {scen.timestamp ? `t = ${scen.timestamp.toFixed(1)}s` : 'timestamped'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleReplay({ ...scen, videoId: vid.videoId })}
                          className="inline-flex items-center gap-1 text-caption font-semibold text-ink hover:underline"
                        >
                          Replay incident
                          <ArrowUpRight size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
