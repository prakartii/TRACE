import { useEffect, useState, useMemo } from 'react'
import { getTemporalPatterns, getPredictiveRisk } from '../api/temporal.js'
import { getScenarioConfig } from '../lib/scenarios.js'

const SEVERITY_BADGE = {
  Critical: 'border-red-500 bg-red-50 text-red-900',
  High: 'border-orange-400 bg-orange-50 text-orange-900',
  Medium: 'border-amber-400 bg-amber-50 text-amber-900',
  Low: 'border-neutral-300 bg-neutral-100 text-neutral-700',
}

/**
 * Humanizes prediction findings into the 5 core operational questions:
 * 1. What did TRACE see?
 * 2. What is happening?
 * 3. Why does it matter?
 * 4. What could happen next?
 * 5. What should the supervisor do?
 */
function getHumanPredictionStory(pred) {
  const scenario = pred.predicted_scenario || ''
  const chainKey = pred.supporting_pattern?.scenario || ''
  const band = pred.predicted_band || 'Medium'

  // Specific high-frequency warehouse precursor chains
  if (scenario === 'precursor_consequence_materialisation') {
    if (chainKey.includes('straps') && chainKey.includes('drop')) {
      return {
        title: 'Packaging Strap Failure Leading to Package Drop',
        whatWeSaw: 'Worker was observed lifting cargo by plastic packaging straps, followed by sudden downward drop motion.',
        whyItMatters: 'Packaging straps are designed for carton bundling, not as handles. Tensile stress can snap straps suddenly during carry.',
        whatMayHappen: 'Strap breakage leading to high-impact floor drop, destroyed merchandise, and hand lacerations.',
        when: 'Within seconds during this handling operation.',
        recommendedResponse: 'Require workers to lift from underneath the carton base with two hands; prohibit carrying by straps.',
        derivationChain: [
          'What we saw: Worker grasping tension straps rather than carton base (observed in video)',
          'Pattern found: Packaging straps used as handles followed by downward acceleration spike',
          'What may happen: Strap rupture causing uncontrolled cargo drop impact',
        ],
      }
    }
    if (chainKey.includes('rolling') && chainKey.includes('dock')) {
      return {
        title: 'Rolling Cargo Nearing Unprotected Dock Edge',
        whatWeSaw: 'Carton was rolled along the floor toward the open dock ledge boundary.',
        whyItMatters: 'Rolling momentum makes heavy cartons difficult to arrest before reaching the unbarricaded dock gap.',
        whatMayHappen: 'Carton rolls off the dock edge into the truck gap or onto the driveway below.',
        when: 'Immediate fall risk if rolling motion continues near the ledge.',
        recommendedResponse: 'Halt cargo rolling immediately; erect dock safety gate and transport with a pallet truck.',
        derivationChain: [
          'What we saw: End-over-end rolling motion detected in loading bay footage',
          'Pattern found: Rolling trajectory moving into calibrated dock-edge perimeter',
          'What may happen: Uncontrolled cargo fall beyond dock perimeter',
        ],
      }
    }
    if (chainKey.includes('drag') && chainKey.includes('orientation')) {
      return {
        title: 'Floor Dragging Resulting in Wrong Package Orientation',
        whatWeSaw: 'Carton was dragged along the floor, leaving it in an inverted or non-compliant orientation.',
        whyItMatters: 'Floor friction catches carton edges, flipping boxes off-axis and violating this-side-up requirements.',
        whatMayHappen: 'Liquid product leakage, internal component shifting, or crush failure under top load.',
        when: 'Before final staging or dispatch palletizing.',
        recommendedResponse: 'Lift and rotate carton to upright orientation matching the manifest label.',
        derivationChain: [
          'What we saw: Horizontal floor dragging followed by aspect ratio shift',
          'Pattern found: Dragging motion altered final package orientation',
          'What may happen: Staging orientation violation causing internal cargo damage',
        ],
      }
    }
    if (chainKey.includes('solo') && chainKey.includes('drop')) {
      return {
        title: 'Fatigue Drop Risk from Solo Heavy Lift',
        whatWeSaw: 'Single worker carried heavy cargo without assistance, followed by unstable slip or drop motion.',
        whyItMatters: 'Solo carry of heavy items causes rapid muscle fatigue and sudden grip failure.',
        whatMayHappen: 'Package dropped onto floor or worker foot; potential lumbar strain injury.',
        when: 'During manual transit across the staging aisle.',
        recommendedResponse: 'Halt solo lifting; assign two-person team lift or dispatch mechanical lifting cart.',
        derivationChain: [
          'What we saw: Heavy SKU handled by single operator followed by velocity spike',
          'Pattern found: Solo heavy carry followed by kinematic instability',
          'What may happen: Worker fatigue resulting in complete drop impact',
        ],
      }
    }

    return {
      title: 'Warning Sign Leading to Secondary Hazard',
      whatWeSaw: 'A known high-risk handling practice was detected immediately prior to a secondary hazard condition.',
      whyItMatters: 'The initial unsafe action directly elevates the likelihood of the follow-on incident occurring.',
      whatMayHappen: 'Compounding damage or handling failure if the initial practice is not corrected.',
      when: 'During the remainder of the current handling cycle.',
      recommendedResponse: 'Intervene on the initial handling practice to prevent the downstream outcome.',
      derivationChain: [
        `What we saw: Precursor event sequence detected in footage`,
        `Pattern found: Chain sequence: ${chainKey.replace(/_/g, ' ')}`,
        `What may happen: Consequential handling incident`,
      ],
    }
  }

  if (scenario === 'confirmed_drop_incident') {
    return {
      title: 'Potential Carton Impact & Drop Damage',
      whatWeSaw: 'Repeated downward acceleration spikes and impact vibrations were detected during cargo transfer.',
      whyItMatters: 'Frequent drop shocks weaken internal packaging, shatter contents, and rupture tape seals.',
      whatMayHappen: 'Severe internal product breakage or carton tearing upon delivery.',
      when: 'Within the current shift if dropping or throwing continues.',
      recommendedResponse: 'Instruct handlers to lower packages gently to the surface; inspect outer cartons for seal failure.',
      derivationChain: [
        'What we saw: Multiple high-acceleration downward motion spikes',
        'Pattern found: Repeating drop/throw handling pattern',
        'What may happen: Confirmed structural rupture and product destruction',
      ],
    }
  }

  if (scenario === 'musculoskeletal_injury_risk') {
    return {
      title: 'Worker Ergonomic Strain & Injury Risk',
      whatWeSaw: 'Heavy packages are repeatedly being lifted and carried by an individual worker without assistance.',
      whyItMatters: 'Continuous solo lifting of heavy SKUs exceeds ergonomic thresholds and leads to severe back injuries.',
      whatMayHappen: 'Worker lumbar strain injury, loss of grip, or sudden dropped load.',
      when: 'Cumulative risk across the current work shift.',
      recommendedResponse: 'Assign a second worker for team lifts or provide a mobile hydraulic lift table.',
      derivationChain: [
        'What we saw: Repeated heavy SKU handling by single operator',
        'Pattern found: Persistent solo heavy lift sequence without assistance',
        'What may happen: Musculoskeletal injury and load drop',
      ],
    }
  }

  if (scenario === 'surface_damage_or_packaging_failure') {
    return {
      title: 'Packaging Abrasion & Floor Drag Damage',
      whatWeSaw: 'Packages are repeatedly being dragged along the floor surface instead of being carried or wheeled.',
      whyItMatters: 'Abrasive floor friction wears through bottom corrugated layers, breaks tape seals, and snags on joints.',
      whatMayHappen: 'Bottom panel burst when lifted, resulting in spilled and damaged inventory.',
      when: 'During next lift or transport stage.',
      recommendedResponse: 'Provide hand trucks or flatbed carts; remind handlers that floor dragging is prohibited.',
      derivationChain: [
        'What we saw: Ground-level translation without vertical clearance',
        'Pattern found: Repeated floor dragging across consecutive packages',
        'What may happen: Carton bottom failure and inventory spill',
      ],
    }
  }

  if (scenario === 'unresolved_escalation') {
    return {
      title: 'Escalating Load Instability Hazard',
      whatWeSaw: 'Risk severity scores have steadily increased across consecutive handling actions without stabilizing.',
      whyItMatters: 'An escalating risk trend indicates that cargo balance or handling conditions are progressively deteriorating.',
      whatMayHappen: 'Sudden stack collapse, toppling cargo, or major handling failure.',
      when: 'Imminent if the handling operation proceeds without stabilization.',
      recommendedResponse: 'Pause the operation immediately; inspect tier alignment and reset the stack footprint.',
      derivationChain: [
        'What we saw: Increasing severity scores across consecutive events',
        'Pattern found: Monotonic risk score escalation across observation window',
        'What may happen: Critical failure or load collapse',
      ],
    }
  }

  // Generic clean fallback
  const cleanTitle = scenario.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return {
    title: cleanTitle,
    whatWeSaw: pred.explanation || 'Repeated operational indicators observed during handling.',
    whyItMatters: 'Unsafe conditions compound over time when handling practices remain uncorrected.',
    whatMayHappen: 'Elevated risk of operational disruption or physical package damage.',
    when: pred.horizon_description || 'During the current work shift.',
    recommendedResponse: 'Inspect the staging area and verify proper handling techniques.',
    derivationChain: pred.prediction_chain || [
      'What we saw: Recorded events from footage',
      'Pattern found: Correlated observation sequence',
      'What may happen: Forecasted operational risk',
    ],
  }
}

/**
 * Humanizes temporal sequence patterns into supervisor-understandable stories.
 */
function getHumanPatternStory(pat) {
  const patternType = pat.pattern_type
  const scenarioKey = pat.scenario || ''
  const config = getScenarioConfig(scenarioKey)
  const count = pat.event_count || 1
  const durationSec = Math.round(pat.time_window_sec || 0)

  if (patternType === 'repeated_behaviour') {
    let title = config.title
    if (scenarioKey === 'entity_in_dock_edge_zone') {
      title = 'Workers Repeatedly In Unsafe Dock-Edge Area'
    } else if (scenarioKey === 'entity_in_wet_floor_zone') {
      title = 'Cargo Handled Repeatedly In Marked Wet Floor Zone'
    } else if (scenarioKey === 'dragging_precursor') {
      title = 'Packages Dragged Across Floor Multiple Times'
    } else if (scenarioKey === 'stepping_on_carton') {
      title = 'Worker Stepping Directly Onto Cartons'
    } else if (scenarioKey === 'straps_as_handles') {
      title = 'Workers Frequently Using Straps as Handles'
    }

    return {
      title,
      badgeLabel: 'UNSAFE BEHAVIOUR REPEATED',
      badgeStyle: 'border-amber-400 bg-amber-50 text-amber-900',
      whatWeSaw: `This unsafe action was detected ${count} times within ${durationSec > 0 ? `${durationSec} seconds` : 'the observation window'}.`,
      whyItMatters: `${config.whyItMatters} Because this happened repeatedly rather than as an isolated slip, it suggests a recurring habit that requires supervisor intervention.`,
      recommendedResponse: config.recommendedAction,
      trendText: pat.score_trend === 'escalating' ? 'Risk severity is increasing' : 'Consistent recurring frequency',
    }
  }

  if (patternType === 'escalating_risk') {
    return {
      title: 'Handling Risk Severity Steadily Increasing',
      badgeLabel: 'RISK IS INCREASING',
      badgeStyle: 'border-red-400 bg-red-50 text-red-900',
      whatWeSaw: `Risk score steadily increased across ${count} consecutive actions over ${durationSec} seconds (peaked at ${Math.round(pat.peak_score || 75)}/100).`,
      whyItMatters: 'A continuous upward severity curve indicates that physical cargo stability or handling posture is deteriorating over time.',
      recommendedResponse: 'Pause the current task immediately to inspect stability and reset the stack footprint.',
      trendText: 'Risk is increasing',
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
      badgeStyle: 'border-purple-400 bg-purple-50 text-purple-900',
      whatWeSaw: `A warning sign (${preConfig.title.toLowerCase()}) occurred, followed by a secondary hazard within ${durationSec} seconds.`,
      whyItMatters: 'The first unsafe handling practice directly created the mechanical conditions for the second hazard to occur.',
      recommendedResponse: `Correct the initial practice: ${preConfig.recommendedAction}`,
      trendText: 'Hazard sequence detected',
    }
  }

  return {
    title: config.title || 'Operational Sequence Pattern',
    badgeLabel: 'PATTERN DETECTED',
    badgeStyle: 'border-neutral-300 bg-neutral-100 text-neutral-800',
    whatWeSaw: `Identified ${count} related observations over ${durationSec} seconds.`,
    whyItMatters: 'Correlated operational events indicate an ongoing workflow pattern.',
    recommendedResponse: config.recommendedAction || 'Review handling practice.',
    trendText: 'Observed pattern',
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

  // Track which cards have their technical evidence & derivation details expanded
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
        // Retain highest severity band
        const rank = { Critical: 3, High: 2, Medium: 1, Low: 0 }
        if ((rank[pred.predicted_band] || 0) > (rank[existing.predicted_band] || 0)) {
          existing.predicted_band = pred.predicted_band
          existing.confidence = pred.confidence
        }
      }
    }

    // Sort by severity (Critical > High > Medium > Low)
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
    <div className="border border-line bg-white shadow-sm flex flex-col transition-all">
      {/* 1. Panel Header: Supervisor-friendly branding */}
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
              TRACE watches sequences of actions across the shift to spot repeating unsafe habits and forecast potential damage before it happens.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Time Scope Selector */}
          <div className="flex items-center gap-1.5 text-xs text-neutral-300 bg-neutral-800 border border-neutral-700 px-2 py-1">
            <span className="text-neutral-400">Time Scope:</span>
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
          {/* 2. Subheader / Tabs & Human Story Pipeline */}
          <div className="flex items-center justify-between border-b border-line bg-neutral-50 px-4 py-2.5 text-xs flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('predictions')}
                className={`px-3 py-1.5 font-bold text-xs border transition-colors cursor-pointer flex items-center gap-2 ${
                  activeTab === 'predictions'
                    ? 'border-neutral-900 bg-neutral-900 text-white shadow-xs'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <span>What May Happen (Forecasts)</span>
                <span className={`px-1.5 py-0.2 text-[10px] font-bold font-mono ${
                  activeTab === 'predictions' ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-900'
                }`}>
                  {predictionCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('patterns')}
                className={`px-3 py-1.5 font-bold text-xs border transition-colors cursor-pointer flex items-center gap-2 ${
                  activeTab === 'patterns'
                    ? 'border-neutral-900 bg-neutral-900 text-white shadow-xs'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <span>Repeated Actions (Patterns)</span>
                <span className={`px-1.5 py-0.2 text-[10px] font-bold font-mono ${
                  activeTab === 'patterns' ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-900'
                }`}>
                  {patternCount}
                </span>
              </button>
            </div>

            {/* Visual Derivation Story Flow */}
            <div className="flex items-center gap-2 text-[11px] text-neutral-600 font-medium">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-700" />
                <span>WHAT WE SAW</span>
              </span>
              <span className="text-neutral-400">➔</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>PATTERN FOUND</span>
              </span>
              <span className="text-neutral-400">➔</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-600" />
                <span>WHAT MAY HAPPEN</span>
              </span>
            </div>
          </div>

          {/* 3. Main Content Surface */}
          <div className="p-4 bg-white">
            {loading && (
              <div className="p-8 text-center text-xs text-neutral-600 flex items-center justify-center gap-2.5">
                <div className="w-4 h-4 border-2 border-neutral-900 border-t-transparent animate-spin" />
                <span>Analyzing video sequences and checking for repeating safety patterns...</span>
              </div>
            )}

            {!loading && error && (
              <div className="p-3 text-xs bg-red-50 border border-red-200 text-red-800 flex items-center gap-2">
                <span className="font-bold">Notice:</span> {error}
              </div>
            )}

            {/* TAB 1: PREDICTIVE RISK FORECASTS */}
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
                      TRACE only generates early warnings when genuine repeating patterns or warning signs are observed.
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
                          className="border border-purple-200 bg-white p-4 shadow-xs flex flex-col justify-between gap-3 hover:border-purple-300 transition-colors"
                        >
                          {/* Top Badges */}
                          <div className="flex items-center justify-between gap-2 border-b border-purple-100 pb-2 flex-wrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-900 border border-purple-300">
                                LIKELY RISK
                              </span>
                              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase border ${SEVERITY_BADGE[pred.predicted_band] || SEVERITY_BADGE.Medium}`}>
                                {pred.predicted_band} Risk
                              </span>
                              <span className="text-[11px] text-neutral-500 font-medium">
                                Certainty: <strong className="text-neutral-800">{pred.confidence}</strong>
                              </span>
                            </div>

                            <span className="text-[11px] font-mono text-neutral-500">
                              {eventCount} {eventCount === 1 ? 'observation' : 'observations'}
                            </span>
                          </div>

                          {/* Card Title */}
                          <div>
                            <h4 className="text-sm font-bold text-neutral-900 leading-snug">
                              {story.title}
                            </h4>
                          </div>

                          {/* 5-Question Story Body */}
                          <div className="flex flex-col gap-2 text-xs">
                            {/* What we saw */}
                            <div className="bg-neutral-50 p-2.5 border border-line">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-0.5">
                                What we saw:
                              </span>
                              <p className="text-neutral-800 leading-relaxed font-sans">
                                {story.whatWeSaw}
                              </p>
                            </div>

                            {/* Why it matters */}
                            <div className="bg-amber-50/50 p-2.5 border border-amber-200/80">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block mb-0.5">
                                Why it matters:
                              </span>
                              <p className="text-amber-950 leading-relaxed font-sans">
                                {story.whyItMatters}
                              </p>
                            </div>

                            {/* What may happen */}
                            <div className="bg-purple-50/50 p-2.5 border border-purple-200/80">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-900 block mb-0.5">
                                What may happen:
                              </span>
                              <p className="text-purple-950 font-medium leading-relaxed font-sans">
                                {story.whatMayHappen}
                              </p>
                              <div className="mt-1.5 pt-1.5 border-t border-purple-200/50 text-[11px] text-neutral-600 flex items-center justify-between">
                                <span>When this could happen:</span>
                                <span className="font-semibold text-purple-900">{story.when}</span>
                              </div>
                            </div>

                            {/* What should the supervisor do */}
                            <div className="bg-emerald-50/60 p-2.5 border border-emerald-300">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-900 block mb-0.5">
                                Recommended response:
                              </span>
                              <p className="text-emerald-950 font-bold leading-relaxed font-sans">
                                {story.recommendedResponse}
                              </p>
                            </div>
                          </div>

                          {/* Expandable Evidence & Technical Proof Bar */}
                          <div className="pt-2 border-t border-line/60">
                            <button
                              type="button"
                              onClick={() => toggleEvidence(pred.prediction_id)}
                              className="text-xs text-neutral-700 hover:text-neutral-950 font-semibold flex items-center justify-between w-full py-1 cursor-pointer"
                            >
                              <span className="flex items-center gap-1.5">
                                <span className="font-bold text-neutral-900">Evidence &amp; Derivation Details</span>
                                <span className="text-neutral-500 font-mono text-[11px]">({eventCount} events)</span>
                              </span>
                              <span className="text-[11px] font-mono text-neutral-500">
                                {isExpanded ? '▲ Hide Details' : '▼ View Evidence'}
                              </span>
                            </button>

                            {isExpanded && (
                              <div className="mt-2 p-3 bg-neutral-50 border border-line flex flex-col gap-2.5 text-xs">
                                {/* Derivation Steps */}
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                                    How TRACE reached this conclusion:
                                  </span>
                                  {story.derivationChain.map((step, idx) => (
                                    <div key={idx} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                                      <span className="font-bold text-neutral-500 font-mono">{idx + 1}.</span>
                                      <span className={idx === 2 ? 'text-purple-950 font-semibold' : 'text-neutral-800'}>
                                        {step}
                                      </span>
                                    </div>
                                  ))}
                                </div>

                                {/* Supporting Event Buttons */}
                                <div className="pt-2 border-t border-line/60 flex flex-col gap-1">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                                    Click any event to inspect video replay &amp; recorded evidence:
                                  </span>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {pred.supporting_event_ids.map((eid) => (
                                      <button
                                        key={eid}
                                        type="button"
                                        onClick={() => onSelectEvent && onSelectEvent(eid)}
                                        className="px-2 py-0.5 bg-white border border-neutral-300 text-neutral-900 hover:border-neutral-900 font-mono text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs"
                                        title={`Jump to Event #${eid} in recorded incident list`}
                                      >
                                        #{eid}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div className="text-[10px] text-neutral-500 italic pt-1 border-t border-line/40">
                                  Early warning signal grounded in real video detections. This hazard has not yet resulted in physical damage.
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: TEMPORAL PATTERNS (REPEATED BEHAVIOURS) */}
            {!loading && !error && activeTab === 'patterns' && (
              <div className="flex flex-col gap-4">
                {patternCount === 0 ? (
                  <div className="border border-dashed border-line p-6 text-center text-xs text-neutral-600 bg-neutral-50/50">
                    <p className="font-bold text-neutral-800 text-sm mb-1">
                      No Repeating Behaviour Patterns Detected
                    </p>
                    <p className="text-xs text-neutral-600 max-w-lg mx-auto leading-relaxed">
                      TRACE requires at least two correlating handling actions within the time scope to identify a recurring behavioural pattern.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {consolidatedPatterns.map((pat, idx) => {
                      const story = getHumanPatternStory(pat)
                      const cardId = `pattern_${idx}_${pat.scenario}`
                      const isExpanded = Boolean(expandedEvidence[cardId])
                      const eventCount = pat.supporting_event_ids?.length || 1

                      return (
                        <div
                          key={cardId}
                          className="border border-amber-200 bg-white p-4 shadow-xs flex flex-col justify-between gap-3 hover:border-amber-300 transition-colors"
                        >
                          {/* Top Badges */}
                          <div className="flex items-center justify-between gap-2 border-b border-amber-100 pb-2 flex-wrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${story.badgeStyle}`}>
                                {story.badgeLabel}
                              </span>
                              <span className="text-[11px] text-neutral-700 font-medium bg-neutral-100 px-2 py-0.5 border border-line">
                                {story.trendText}
                              </span>
                              {pat.peak_score != null && (
                                <span className="text-[11px] text-neutral-600 font-mono">
                                  Peak: <strong className="text-neutral-900">{Math.round(pat.peak_score)}/100</strong>
                                </span>
                              )}
                            </div>

                            <span className="text-[11px] font-mono text-neutral-500">
                              {eventCount} {eventCount === 1 ? 'event' : 'events'}
                            </span>
                          </div>

                          {/* Card Title */}
                          <div>
                            <h4 className="text-sm font-bold text-neutral-900 leading-snug">
                              {story.title}
                            </h4>
                          </div>

                          {/* Story Details */}
                          <div className="flex flex-col gap-2 text-xs">
                            {/* What we saw */}
                            <div className="bg-neutral-50 p-2.5 border border-line">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-0.5">
                                What we saw:
                              </span>
                              <p className="text-neutral-800 leading-relaxed font-sans">
                                {story.whatWeSaw}
                              </p>
                            </div>

                            {/* Why it matters */}
                            <div className="bg-amber-50/50 p-2.5 border border-amber-200/80">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block mb-0.5">
                                Why this matters:
                              </span>
                              <p className="text-amber-950 leading-relaxed font-sans">
                                {story.whyItMatters}
                              </p>
                            </div>

                            {/* Recommended response */}
                            <div className="bg-emerald-50/60 p-2.5 border border-emerald-300">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-900 block mb-0.5">
                                Recommended response:
                              </span>
                              <p className="text-emerald-950 font-bold leading-relaxed font-sans">
                                {story.recommendedResponse}
                              </p>
                            </div>
                          </div>

                          {/* Expandable Evidence Bar */}
                          <div className="pt-2 border-t border-line/60">
                            <button
                              type="button"
                              onClick={() => toggleEvidence(cardId)}
                              className="text-xs text-neutral-700 hover:text-neutral-950 font-semibold flex items-center justify-between w-full py-1 cursor-pointer"
                            >
                              <span className="flex items-center gap-1.5">
                                <span className="font-bold text-neutral-900">Evidence Details</span>
                                <span className="text-neutral-500 font-mono text-[11px]">({eventCount} events recorded)</span>
                              </span>
                              <span className="text-[11px] font-mono text-neutral-500">
                                {isExpanded ? '▲ Hide Details' : '▼ View Evidence'}
                              </span>
                            </button>

                            {isExpanded && (
                              <div className="mt-2 p-3 bg-neutral-50 border border-line flex flex-col gap-2 text-xs">
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                                    Click any event to inspect video replay &amp; recorded evidence:
                                  </span>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {pat.supporting_event_ids.map((eid) => (
                                      <button
                                        key={eid}
                                        type="button"
                                        onClick={() => onSelectEvent && onSelectEvent(eid)}
                                        className="px-2 py-0.5 bg-white border border-neutral-300 text-neutral-900 hover:border-neutral-900 font-mono text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs"
                                        title={`Jump to Event #${eid} in recorded incident list`}
                                      >
                                        #{eid}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div className="text-[10px] text-neutral-500 italic pt-1 border-t border-line/40">
                                  Derived deterministically from consecutive video analysis detections across the specified time scope.
                                </div>
                              </div>
                            )}
                          </div>
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
