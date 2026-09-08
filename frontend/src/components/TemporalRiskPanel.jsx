import { useEffect, useState, useMemo } from 'react'
import { getTemporalPatterns, getPredictiveRisk } from '../api/temporal.js'
import { getScenarioConfig } from '../lib/scenarios.js'

const SEVERITY_BADGE = {
  Critical: 'border-red-400 bg-red-50 text-red-800',
  High: 'border-orange-300 bg-orange-50 text-orange-800',
  Medium: 'border-amber-300 bg-amber-50 text-amber-800',
  Low: 'border-neutral-300 bg-neutral-100 text-neutral-700',
}

/**
 * Humanizes prediction findings into simple operational cards:
 * - What is happening
 * - When it may happen
 * - What to do
 * - Why we're warning you
 */
function getHumanPredictionStory(pred) {
  const scenario = pred.predicted_scenario || ''
  const chainKey = pred.supporting_pattern?.scenario || ''

  if (scenario === 'precursor_consequence_materialisation') {
    if (chainKey.includes('straps') && chainKey.includes('drop')) {
      return {
        title: 'Packaging may fail and drop if lifted by straps',
        explanation: 'Workers were observed lifting cargo by plastic packaging straps followed by sudden drop motion. Straps can snap unexpectedly under tension.',
        recommendedResponse: 'Lift packages from underneath the carton base with two hands; never carry by packaging straps.',
        whyWarning: 'Packaging straps used as lifting handles detected in monitored footage.',
        when: 'Within seconds during handling',
        derivationChain: [
          'What we saw: Worker grasping tension straps rather than carton base in video footage',
          'Pattern found: Packaging straps used as handles followed by downward acceleration spike',
          'What may happen: Strap rupture causing uncontrolled cargo drop impact',
        ],
      }
    }
    if (chainKey.includes('rolling') && chainKey.includes('dock')) {
      return {
        title: 'Rolling cargo may fall from unprotected dock ledge',
        explanation: 'Carton was rolled along the floor toward the open dock ledge boundary. Momentum makes rolling cargo difficult to arrest before reaching the edge.',
        recommendedResponse: 'Halt cargo rolling immediately; erect safety barrier and transport using a pallet truck.',
        whyWarning: 'Rolling cargo moving toward dock edge detected in monitored footage.',
        when: 'Immediate hazard near dock ledge',
        derivationChain: [
          'What we saw: End-over-end rolling motion detected in loading bay footage',
          'Pattern found: Rolling trajectory moving toward calibrated dock-edge perimeter',
          'What may happen: Uncontrolled cargo fall beyond dock perimeter',
        ],
      }
    }
    if (chainKey.includes('drag') && chainKey.includes('orientation')) {
      return {
        title: 'Packages may be damaged if floor dragging continues',
        explanation: 'Carton was dragged along the floor, leaving it inverted and non-compliant with orientation labels. Floor friction flips boxes and damages packaging.',
        recommendedResponse: 'Lift and rotate carton to upright orientation matching the manifest; use a hand truck for transit.',
        whyWarning: 'Floor dragging resulting in non-compliant orientation detected in footage.',
        when: 'Before staging and palletizing',
        derivationChain: [
          'What we saw: Horizontal floor dragging followed by aspect ratio shift',
          'Pattern found: Dragging motion altered final package orientation',
          'What may happen: Staging orientation violation causing internal cargo damage',
        ],
      }
    }
    if (chainKey.includes('solo') && chainKey.includes('drop')) {
      return {
        title: 'Cargo drop risk from solo heavy handling',
        explanation: 'A single worker handled heavy cargo without assistance, followed by unstable slip motion. Fatigue from heavy solo lifts causes sudden grip failure.',
        recommendedResponse: 'Halt solo lifting; assign two-person team lift or dispatch mechanical lifting cart.',
        whyWarning: 'Solo heavy carry followed by kinematic instability detected in footage.',
        when: 'During manual transit across aisle',
        derivationChain: [
          'What we saw: Heavy SKU handled by single operator followed by velocity spike',
          'Pattern found: Solo heavy carry followed by kinematic instability',
          'What may happen: Worker fatigue resulting in complete drop impact',
        ],
      }
    }

    return {
      title: 'Unsafe handling action likely to cause secondary hazard',
      explanation: 'A high-risk handling practice was detected immediately prior to an unstable condition, increasing the probability of a follow-on incident.',
      recommendedResponse: 'Intervene on the initial handling practice to prevent the downstream hazard.',
      whyWarning: 'Hazard sequence detected in monitored footage.',
      when: 'During the current handling cycle',
      derivationChain: [
        `What we saw: Precursor event sequence detected in footage`,
        `Pattern found: Chain sequence: ${chainKey.replace(/_/g, ' ')}`,
        `What may happen: Consequential handling incident`,
      ],
    }
  }

  if (scenario === 'confirmed_drop_incident') {
    return {
      title: 'Packages at risk of impact damage from repeated drops',
      explanation: 'Downward acceleration shocks and impact vibrations were detected during transfer. Frequent drop shocks shatter contents and rupture outer seals.',
      recommendedResponse: 'Instruct handlers to lower packages gently; inspect outer cartons for seal failure or breakage.',
      whyWarning: 'Repeating drop and throw motions detected in monitored footage.',
      when: 'Within the current shift',
      derivationChain: [
        'What we saw: Multiple high-acceleration downward motion spikes',
        'Pattern found: Repeating drop/throw handling pattern',
        'What may happen: Confirmed structural rupture and product destruction',
      ],
    }
  }

  if (scenario === 'musculoskeletal_injury_risk') {
    return {
      title: 'Worker strain and dropped cargo risk from heavy solo lifts',
      explanation: 'Heavy packages are repeatedly being lifted by an individual worker without assistance, exceeding safe ergonomic thresholds.',
      recommendedResponse: 'Assign a second worker for team lifts or provide a mobile hydraulic lift table.',
      whyWarning: 'Repeated solo heavy lifting detected in monitored footage.',
      when: 'Cumulative risk across shift',
      derivationChain: [
        'What we saw: Repeated heavy SKU handling by single operator',
        'Pattern found: Persistent solo heavy lift sequence without assistance',
        'What may happen: Musculoskeletal injury and load drop',
      ],
    }
  }

  if (scenario === 'surface_damage_or_packaging_failure') {
    return {
      title: 'Carton burst and spill hazard from floor dragging',
      explanation: 'Packages are repeatedly being dragged along the floor surface. Abrasive friction wears through bottom corrugated layers and weakens tape seals.',
      recommendedResponse: 'Provide hand trucks or flatbed carts; remind handlers that floor dragging is prohibited.',
      whyWarning: 'Repeated ground-level dragging detected in monitored footage.',
      when: 'During next lift or transport stage',
      derivationChain: [
        'What we saw: Ground-level translation without vertical clearance',
        'Pattern found: Repeated floor dragging across consecutive packages',
        'What may happen: Carton bottom failure and inventory spill',
      ],
    }
  }

  if (scenario === 'unresolved_escalation') {
    return {
      title: 'Stack collapse hazard from escalating load instability',
      explanation: 'Risk severity scores have steadily increased across consecutive actions without stabilizing, indicating progressively deteriorating cargo balance.',
      recommendedResponse: 'Pause the operation immediately; inspect tier alignment and reset the stack footprint.',
      whyWarning: 'Progressive risk score escalation detected in monitored footage.',
      when: 'Imminent if handling proceeds without stabilization',
      derivationChain: [
        'What we saw: Increasing severity scores across consecutive events',
        'Pattern found: Monotonic risk score escalation across observation window',
        'What may happen: Critical failure or load collapse',
      ],
    }
  }

  const cleanTitle = scenario.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return {
    title: cleanTitle,
    explanation: pred.explanation || 'Repeated operational indicators suggest heightened risk during the current workflow.',
    recommendedResponse: 'Inspect the staging area and verify proper handling techniques.',
    whyWarning: 'Detected repeatedly in the monitored footage.',
    when: pred.horizon_description || 'During the current work shift',
    derivationChain: pred.prediction_chain || [
      'What we saw: Recorded events from footage',
      'Pattern found: Correlated observation sequence',
      'What may happen: Forecasted operational risk',
    ],
  }
}

/**
 * Humanizes temporal sequence patterns into natural, non-repetitive operational summaries.
 */
function getHumanPatternStory(pat) {
  const patternType = pat.pattern_type
  const scenarioKey = pat.scenario || ''
  const config = getScenarioConfig(scenarioKey)

  if (patternType === 'repeated_behaviour') {
    if (scenarioKey === 'entity_in_dock_edge_zone') {
      return {
        title: 'Workers repeatedly entering the dock-edge area',
        badgeLabel: 'UNSAFE BEHAVIOUR REPEATED',
        badgeStyle: 'border-amber-300 bg-amber-50 text-amber-900',
        whyItMatters: 'Repeated presence at the unprotected dock ledge significantly increases the risk of a worker falling into the drive gap.',
        recommendedResponse: 'Move at least 2 m away from the dock edge and secure the bay safety gate.',
      }
    }
    if (scenarioKey === 'entity_in_wet_floor_zone') {
      return {
        title: 'Cargo handled repeatedly in marked wet floor zone',
        badgeLabel: 'UNSAFE BEHAVIOUR REPEATED',
        badgeStyle: 'border-amber-300 bg-amber-50 text-amber-900',
        whyItMatters: 'Footwear and wheel traction are severely reduced on wet floors, increasing slip hazards and dropped loads.',
        recommendedResponse: 'Reroute cargo transit away from the wet zone; place caution cones until dry.',
      }
    }
    if (scenarioKey === 'dragging_precursor') {
      return {
        title: 'Packages dragged across floor multiple times',
        badgeLabel: 'UNSAFE BEHAVIOUR REPEATED',
        badgeStyle: 'border-amber-300 bg-amber-50 text-amber-900',
        whyItMatters: 'Floor friction wears through carton bottom panels, causing packages to burst open when lifted.',
        recommendedResponse: 'Transport packages on hand trucks or flatbed carts; do not drag boxes along the floor.',
      }
    }
    if (scenarioKey === 'stepping_on_carton') {
      return {
        title: 'Worker repeatedly stepping onto cargo cartons',
        badgeLabel: 'UNSAFE BEHAVIOUR REPEATED',
        badgeStyle: 'border-amber-300 bg-amber-50 text-amber-900',
        whyItMatters: 'Corrugated boxes are not rated to support human body weight. Carton collapse can cause severe falls and crush contents.',
        recommendedResponse: 'Step off cartons immediately; use an approved safety ladder or step stool.',
      }
    }
    if (scenarioKey === 'straps_as_handles') {
      return {
        title: 'Workers frequently using packaging straps as handles',
        badgeLabel: 'UNSAFE BEHAVIOUR REPEATED',
        badgeStyle: 'border-amber-300 bg-amber-50 text-amber-900',
        whyItMatters: 'Straps can snap without warning under dynamic lifting tension, causing the package to drop heavily onto the floor or feet.',
        recommendedResponse: 'Lift from the carton base using two hands; strictly prohibit carrying by tension straps.',
      }
    }
    if (scenarioKey === 'box_overhang') {
      return {
        title: 'Packages stacked repeatedly with severe overhang',
        badgeLabel: 'UNSAFE BEHAVIOUR REPEATED',
        badgeStyle: 'border-amber-300 bg-amber-50 text-amber-900',
        whyItMatters: 'Unsupported overhang creates an eccentric center of gravity that causes stacks to topple under slight vibration.',
        recommendedResponse: 'Re-align cartons within the pallet perimeter; ensure 100% base support.',
      }
    }
    if (scenarioKey === 'heavy_on_light_stacking') {
      return {
        title: 'Heavy cartons repeatedly stacked on lighter cartons',
        badgeLabel: 'UNSAFE BEHAVIOUR REPEATED',
        badgeStyle: 'border-amber-300 bg-amber-50 text-amber-900',
        whyItMatters: 'Excessive top load crushes base carton sidewalls and leads to top-heavy stack collapse.',
        recommendedResponse: 'Stack heaviest packages at the base tier; restack pallet before transport.',
      }
    }

    return {
      title: config.title || 'Repeated Unsafe Handling Habit',
      badgeLabel: 'UNSAFE BEHAVIOUR REPEATED',
      badgeStyle: 'border-amber-300 bg-amber-50 text-amber-900',
      whyItMatters: config.whyItMatters || 'Repeated occurrences suggest a persistent handling habit that elevates operational risk.',
      recommendedResponse: config.recommendedAction || 'Review handling practice with warehouse team.',
    }
  }

  if (patternType === 'escalating_risk') {
    return {
      title: 'Handling risk severity steadily increasing',
      badgeLabel: 'RISK IS INCREASING',
      badgeStyle: 'border-red-400 bg-red-50 text-red-900',
      whyItMatters: 'Consecutive actions show worsening cargo instability, indicating that the stack or handling posture is progressively deteriorating.',
      recommendedResponse: 'Pause the operation immediately; inspect tier stability and reset the stack footprint.',
    }
  }

  if (patternType === 'precursor_sequence') {
    const parts = scenarioKey.split('→')
    const preKey = parts[0]?.trim() || ''
    const conKey = parts[1]?.trim() || ''
    const preConfig = getScenarioConfig(preKey)
    const conConfig = getScenarioConfig(conKey)

    return {
      title: `${preConfig.title} → ${conConfig.title}`,
      badgeLabel: 'WARNING SIGN SEQUENCE',
      badgeStyle: 'border-purple-300 bg-purple-50 text-purple-900',
      whyItMatters: 'The first unsafe handling practice directly created the mechanical conditions for the second hazard to occur.',
      recommendedResponse: `Correct initial practice: ${preConfig.recommendedAction}`,
    }
  }

  return {
    title: config.title || 'Repeated Operational Pattern',
    badgeLabel: 'PATTERN DETECTED',
    badgeStyle: 'border-neutral-300 bg-neutral-100 text-neutral-800',
    whyItMatters: 'Correlated operational actions indicate a repeating handling pattern.',
    recommendedResponse: config.recommendedAction || 'Review handling practice.',
  }
}

export default function TemporalRiskPanel({
  videoId = null,
  lens = null,
  scenario = null,
  onSelectEvent = null,
}) {
  const [activeTab, setActiveTab] = useState('predictions') // 'predictions' | 'patterns'
  const [windowSec, setWindowSec] = useState(300)
  const [patternsData, setPatternsData] = useState(null)
  const [predictiveData, setPredictiveData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [collapsed, setCollapsed] = useState(false)

  // Track which cards have their evidence details expanded
  const [expandedEvidence, setExpandedEvidence] = useState({})

  const toggleEvidence = (id) => {
    setExpandedEvidence((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [patterns, predictions] = await Promise.all([
        getTemporalPatterns({ videoId, lens, scenario, windowSec }).catch((e) => ({
          error: e.message,
          patterns: [],
          insufficient_evidence: true,
        })),
        getPredictiveRisk({ videoId, lens, scenario, windowSec }).catch((e) => ({
          error: e.message,
          predictions: [],
          insufficient_evidence: true,
        })),
      ])
      setPatternsData(patterns)
      setPredictiveData(predictions)
    } catch (err) {
      setError(err.message || 'Failed to evaluate operational risk patterns.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [videoId, lens, scenario, windowSec])

  // Consolidate redundant predictions by scenario/chain to present compact, non-duplicated intelligence
  const consolidatedPredictions = useMemo(() => {
    if (!predictiveData?.predictions?.length) return []
    const groups = new Map()

    for (const pred of predictiveData.predictions) {
      const chainKey = pred.supporting_pattern?.scenario || pred.predicted_scenario
      const key = `${pred.predicted_scenario}::${chainKey}`

      if (!groups.has(key)) {
        groups.set(key, {
          ...pred,
          instances: [pred],
          allEventIds: new Set(pred.supporting_event_ids || []),
        })
      } else {
        const existing = groups.get(key)
        existing.instances.push(pred)
        for (const id of pred.supporting_event_ids || []) {
          existing.allEventIds.add(id)
        }
        const rank = { Critical: 3, High: 2, Medium: 1, Low: 0 }
        if ((rank[pred.predicted_band] || 0) > (rank[existing.predicted_band] || 0)) {
          existing.predicted_band = pred.predicted_band
          existing.confidence = pred.confidence
        }
      }
    }

    const rank = { Critical: 3, High: 2, Medium: 1, Low: 0 }
    return Array.from(groups.values())
      .map((g) => ({
        ...g,
        supporting_event_ids: Array.from(g.allEventIds).sort((a, b) => a - b),
        occurrenceCount: g.instances.length,
      }))
      .sort((a, b) => (rank[b.predicted_band] || 0) - (rank[a.predicted_band] || 0))
  }, [predictiveData])

  // Consolidate redundant temporal patterns by pattern_type and scenario
  const consolidatedPatterns = useMemo(() => {
    if (!patternsData?.patterns?.length) return []
    const groups = new Map()

    for (const pat of patternsData.patterns) {
      const key = `${pat.pattern_type}::${pat.scenario || ''}`
      if (!groups.has(key)) {
        groups.set(key, {
          ...pat,
          instances: [pat],
          allEventIds: new Set(pat.supporting_event_ids || []),
          minTs: pat.first_timestamp,
          maxTs: pat.last_timestamp,
          peakScore: pat.peak_score,
        })
      } else {
        const existing = groups.get(key)
        existing.instances.push(pat)
        for (const id of pat.supporting_event_ids || []) {
          existing.allEventIds.add(id)
        }
        existing.minTs = Math.min(existing.minTs, pat.first_timestamp)
        existing.maxTs = Math.max(existing.maxTs, pat.last_timestamp)
        if (pat.peak_score != null) {
          existing.peakScore = Math.max(existing.peakScore ?? 0, pat.peak_score)
        }
      }
    }

    return Array.from(groups.values()).map((g) => ({
      ...g,
      supporting_event_ids: Array.from(g.allEventIds).sort((a, b) => a - b),
      first_timestamp: g.minTs,
      last_timestamp: g.maxTs,
      time_window_sec: Math.max(0, g.maxTs - g.minTs),
      event_count: g.allEventIds.size,
      peak_score: g.peakScore,
      occurrenceCount: g.instances.length,
    }))
  }, [patternsData])

  const patternCount = consolidatedPatterns.length
  const predictionCount = consolidatedPredictions.length

  return (
    <div className="border border-line bg-white shadow-xs flex flex-col transition-all">
      {/* 1. Panel Header: Restored Authoritative Black Banner */}
      <div className="border-b border-line p-4 bg-neutral-900 text-white flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold tracking-wide text-white uppercase">
                Early Warning &amp; Operational Patterns
              </h3>
              <span className="text-[10px] font-bold bg-neutral-800 text-emerald-400 border border-neutral-700 px-2 py-0.5">
                ACTIVE MONITORING
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              TRACE doesn't only detect incidents — it notices repeated unsafe behaviour and warns about what could happen next.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Time Scope Selector */}
          <div className="flex items-center gap-1.5 text-xs text-neutral-300 bg-neutral-800 border border-neutral-700 px-2 py-1">
            <span className="text-neutral-400 font-medium">Time Scope:</span>
            <select
              value={windowSec}
              onChange={(e) => setWindowSec(Number(e.target.value))}
              className="bg-neutral-900 border-none text-white text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value={60}>Last 1 min (60s)</option>
              <option value={120}>Last 2 mins (120s)</option>
              <option value={300}>Last 5 mins (300s)</option>
              <option value={900}>Last 15 mins</option>
              <option value={3600}>Entire Shift (1 hr)</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="text-neutral-300 hover:text-white px-2 py-1 text-xs border border-neutral-700 hover:border-neutral-500 transition-colors cursor-pointer"
            title={collapsed ? 'Expand section' : 'Collapse section'}
          >
            {collapsed ? '▼ Show Early Warnings' : '▲ Minimize'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* 2. Sub-Header: Tabs & Primary Operational Purpose */}
          <div className="flex items-center justify-between border-b border-line bg-paper px-4 py-2.5 text-xs flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('predictions')}
                className={`px-3 py-1.5 font-bold text-xs border transition-colors cursor-pointer flex items-center gap-2 ${
                  activeTab === 'predictions'
                    ? 'border-neutral-900 bg-neutral-900 text-white shadow-2xs'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <span>LIKELY NEXT RISKS</span>
                <span className={`px-1.5 py-0.2 text-[10px] font-bold font-mono ${
                  activeTab === 'predictions' ? 'bg-amber-500 text-white' : 'bg-neutral-200 text-neutral-800'
                }`}>
                  {predictionCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('patterns')}
                className={`px-3 py-1.5 font-bold text-xs border transition-colors cursor-pointer flex items-center gap-2 ${
                  activeTab === 'patterns'
                    ? 'border-neutral-900 bg-neutral-900 text-white shadow-2xs'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <span>REPEATED UNSAFE BEHAVIOUR</span>
                <span className={`px-1.5 py-0.2 text-[10px] font-bold font-mono ${
                  activeTab === 'patterns' ? 'bg-amber-500 text-white' : 'bg-neutral-200 text-neutral-800'
                }`}>
                  {patternCount}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-neutral-600">
              <span className="font-semibold text-neutral-800">What should I watch out for next?</span>
              <span className="text-neutral-400 hidden md:inline">· Forecasts and recurring handling habits</span>
            </div>
          </div>

          {/* 3. Cards Grid: Clean 2-column layout */}
          <div className="p-4 bg-white">
            {loading && (
              <div className="p-8 text-center text-xs text-neutral-600 flex items-center justify-center gap-2.5">
                <div className="w-4 h-4 border-2 border-neutral-900 border-t-transparent animate-spin" />
                <span>Evaluating operational patterns across the shift...</span>
              </div>
            )}

            {!loading && error && (
              <div className="p-3 text-xs bg-red-50 border border-red-200 text-red-800 flex items-center gap-2">
                <span className="font-bold">Notice:</span> {error}
              </div>
            )}

            {/* TAB 1: LIKELY NEXT RISKS */}
            {!loading && !error && activeTab === 'predictions' && (
              <div className="flex flex-col gap-4">
                {predictionCount === 0 ? (
                  <div className="border border-dashed border-line p-6 text-center text-xs text-neutral-600 bg-neutral-50/50">
                    <p className="font-bold text-neutral-800 text-sm mb-1">
                      No Compounding Safety Risks Detected
                    </p>
                    <p className="text-xs text-neutral-600 max-w-lg mx-auto leading-relaxed">
                      Current video observations show isolated events without multi-step escalation or repeating warning signs in this time scope.
                    </p>
                    <p className="text-[11px] text-neutral-500 mt-2 italic">
                      TRACE only warns about future risk when genuine repeating patterns or warning signs are observed.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {consolidatedPredictions.map((pred) => {
                      const story = getHumanPredictionStory(pred)
                      const isExpanded = Boolean(expandedEvidence[pred.prediction_id])
                      const eventCount = pred.supporting_event_ids?.length || 1

                      return (
                        <div
                          key={pred.prediction_id}
                          className="border border-line bg-white p-4 shadow-2xs flex flex-col justify-between gap-3 hover:border-neutral-400 transition-colors"
                        >
                          {/* 1. [RISK LEVEL]   [WHEN IT MAY HAPPEN] */}
                          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${SEVERITY_BADGE[pred.predicted_band] || SEVERITY_BADGE.Medium}`}>
                                {pred.predicted_band ? `${pred.predicted_band.toUpperCase()} RISK` : 'LIKELY RISK'}
                              </span>
                              <span className="text-[11px] text-neutral-600 font-medium">
                                {story.when}
                              </span>
                            </div>
                            <span className="text-[11px] text-neutral-500 font-mono">
                              CONFIDENCE: <strong className="text-neutral-800">{pred.confidence}</strong>
                            </span>
                          </div>

                          {/* 2. Clear human title */}
                          <h4 className="text-sm font-bold text-neutral-950 leading-snug">
                            {story.title}
                          </h4>

                          {/* 3. Short explanation */}
                          <p className="text-xs text-neutral-700 leading-relaxed font-sans">
                            {story.explanation}
                          </p>

                          {/* 4. WHAT TO DO (Prominent Green Box) */}
                          {story.recommendedResponse && (
                            <div className="text-xs text-emerald-950 bg-emerald-50/70 border border-emerald-200/80 p-2.5 leading-relaxed">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block mb-0.5">
                                WHAT TO DO:
                              </span>
                              <p className="font-semibold">{story.recommendedResponse}</p>
                            </div>
                          )}

                          {/* 5. WHY WE'RE WARNING YOU (Compact) */}
                          <div className="text-xs text-neutral-600 leading-relaxed">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-0.5">
                              WHY WE'RE WARNING YOU:
                            </span>
                            <p>{story.whyWarning}</p>
                          </div>

                          {/* 6. Clean Organized Evidence Row (No wall of pills!) */}
                          <div className="border-t border-line/60 pt-2.5 flex items-center justify-between text-xs text-neutral-600 flex-wrap gap-2">
                            <div className="flex items-center gap-1.5 font-medium">
                              <span className="text-neutral-500">Evidence:</span>
                              <span className="text-neutral-900 font-semibold">{eventCount} video {eventCount === 1 ? 'observation' : 'observations'}</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => toggleEvidence(pred.prediction_id)}
                              className="text-xs text-neutral-700 hover:text-neutral-950 font-semibold cursor-pointer flex items-center gap-1 px-2 py-0.5 border border-line bg-neutral-50 hover:bg-neutral-100 transition-colors"
                            >
                              <span>{isExpanded ? 'Hide evidence' : 'View evidence'}</span>
                              <span className="font-mono text-[10px]">{isExpanded ? '▲' : '▾'}</span>
                            </button>
                          </div>

                          {/* 7. Collapsible Organized Evidence Container */}
                          {isExpanded && (
                            <div className="mt-1 p-3 bg-neutral-50 border border-line flex flex-col gap-2.5 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                                  Monitored Video Observations ({eventCount}):
                                </span>
                                <span className="text-[10px] text-neutral-500">
                                  Click any to inspect incident
                                </span>
                              </div>

                              {/* Compact scrollable container */}
                              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                                {pred.supporting_event_ids.map((eid) => (
                                  <button
                                    key={eid}
                                    type="button"
                                    onClick={() => onSelectEvent && onSelectEvent(eid)}
                                    className="px-1.5 py-0.5 bg-white hover:bg-neutral-900 hover:text-white border border-neutral-300 text-neutral-800 font-mono text-[10px] font-semibold transition-colors cursor-pointer shadow-2xs"
                                    title={`Select incident #${eid} in recorded incident list`}
                                  >
                                    #{eid}
                                  </button>
                                ))}
                              </div>

                              {/* Technical Details: Reasoning Chain */}
                              <div className="pt-2 border-t border-line/60 flex flex-col gap-1 text-[11px]">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                                  Why TRACE Thinks This:
                                </span>
                                {story.derivationChain.map((step, idx) => (
                                  <div key={idx} className="flex items-start gap-1.5 text-neutral-700 leading-snug">
                                    <span className="font-mono font-bold text-neutral-400">{idx + 1}.</span>
                                    <span>{step}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: REPEATED UNSAFE BEHAVIOUR */}
            {!loading && !error && activeTab === 'patterns' && (
              <div className="flex flex-col gap-4">
                {patternCount === 0 ? (
                  <div className="border border-dashed border-line p-6 text-center text-xs text-neutral-600 bg-neutral-50/50">
                    <p className="font-bold text-neutral-800 text-sm mb-1">
                      No Repeating Behaviour Patterns Detected
                    </p>
                    <p className="text-xs text-neutral-600 max-w-lg mx-auto leading-relaxed">
                      TRACE requires multiple correlating actions within the observation window to establish an operational pattern.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {consolidatedPatterns.map((pat, idx) => {
                      const story = getHumanPatternStory(pat)
                      const cardId = `pattern_${idx}_${pat.scenario}`
                      const isExpanded = Boolean(expandedEvidence[cardId])
                      const eventCount = pat.supporting_event_ids?.length || 1
                      const durationSec = Math.round(pat.time_window_sec || 0)

                      return (
                        <div
                          key={cardId}
                          className="border border-line bg-white p-4 shadow-2xs flex flex-col justify-between gap-3 hover:border-neutral-400 transition-colors"
                        >
                          {/* 1. Header: UNSAFE BEHAVIOUR REPEATED badge & Peak Risk */}
                          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${story.badgeStyle}`}>
                              {story.badgeLabel}
                            </span>
                            {pat.peak_score != null && (
                              <span className="text-[11px] text-neutral-500 font-mono">
                                Peak Risk: <strong className="text-neutral-800">{Math.round(pat.peak_score)}/100</strong>
                              </span>
                            )}
                          </div>

                          {/* 2. Clear human title */}
                          <h4 className="text-sm font-bold text-neutral-950 leading-snug">
                            {story.title}
                          </h4>

                          {/* 3. Occurrence Count in natural terms */}
                          <div className="text-xs text-neutral-600 font-medium">
                            Detected <strong className="font-mono text-neutral-900">{eventCount} times</strong> {durationSec > 0 ? `in ${durationSec} seconds.` : 'during the observation window.'}
                          </div>

                          {/* 4. WHY IT MATTERS */}
                          <div className="text-xs text-neutral-700 leading-relaxed">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block mb-0.5">
                              WHY IT MATTERS:
                            </span>
                            <p>{story.whyItMatters}</p>
                          </div>

                          {/* 5. WHAT TO DO (Prominent Green Box) */}
                          {story.recommendedResponse && (
                            <div className="text-xs text-emerald-950 bg-emerald-50/70 border border-emerald-200/80 p-2.5 leading-relaxed">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block mb-0.5">
                                WHAT TO DO:
                              </span>
                              <p className="font-semibold">{story.recommendedResponse}</p>
                            </div>
                          )}

                          {/* 6. Clean Organized Evidence Row (No wall of pills!) */}
                          <div className="border-t border-line/60 pt-2.5 flex items-center justify-between text-xs text-neutral-600 flex-wrap gap-2">
                            <div className="flex items-center gap-1.5 font-medium">
                              <span className="text-neutral-500">Evidence:</span>
                              <span className="text-neutral-900 font-semibold">{eventCount} video {eventCount === 1 ? 'observation' : 'observations'}</span>
                              {durationSec > 0 && (
                                <>
                                  <span className="text-neutral-400">·</span>
                                  <span className="font-mono text-neutral-600">{durationSec}s</span>
                                </>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => toggleEvidence(cardId)}
                              className="text-xs text-neutral-700 hover:text-neutral-950 font-semibold cursor-pointer flex items-center gap-1 px-2 py-0.5 border border-line bg-neutral-50 hover:bg-neutral-100 transition-colors"
                            >
                              <span>{isExpanded ? 'Hide evidence' : 'View evidence'}</span>
                              <span className="font-mono text-[10px]">{isExpanded ? '▲' : '▾'}</span>
                            </button>
                          </div>

                          {/* 7. Collapsible Organized Evidence Container */}
                          {isExpanded && (
                            <div className="mt-1 p-3 bg-neutral-50 border border-line flex flex-col gap-2 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                                  Monitored Video Observations ({eventCount}):
                                </span>
                                <span className="text-[10px] text-neutral-500">
                                  Click any to inspect incident
                                </span>
                              </div>

                              {/* Compact scrollable container */}
                              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                                {pat.supporting_event_ids.map((eid) => (
                                  <button
                                    key={eid}
                                    type="button"
                                    onClick={() => onSelectEvent && onSelectEvent(eid)}
                                    className="px-1.5 py-0.5 bg-white hover:bg-neutral-900 hover:text-white border border-neutral-300 text-neutral-800 font-mono text-[10px] font-semibold transition-colors cursor-pointer shadow-2xs"
                                    title={`Select incident #${eid} in recorded incident list`}
                                  >
                                    #{eid}
                                  </button>
                                ))}
                              </div>

                              <div className="text-[10px] text-neutral-500 italic pt-1 border-t border-line/50">
                                Observed across {eventCount} video detections over {durationSec} seconds.
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
