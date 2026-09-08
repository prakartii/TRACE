import { useEffect, useState, useMemo } from 'react'
import { getTemporalPatterns, getPredictiveRisk } from '../api/temporal.js'
import { getScenarioConfig } from '../lib/scenarios.js'

const SEVERITY_BADGE = {
  Critical: 'border-danger/40 bg-danger/10 text-danger',
  High: 'border-signal/40 bg-signal/10 text-[#8a5f00]',
  Medium: 'border-steel/40 bg-steel/10 text-steel',
  Low: 'border-line-strong bg-paper text-ink-soft',
}

function getHumanPredictionStory(pred) {
  const scenario = pred.predicted_scenario || ''
  const chainKey = pred.supporting_pattern?.scenario || ''
  const band = pred.predicted_band || 'Medium'

  if (scenario === 'precursor_consequence_materialisation') {
    if (chainKey.includes('straps') && chainKey.includes('drop')) {
      return {
        title: 'Packaging strap failure leading to package drop',
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
        title: 'Rolling cargo nearing unprotected dock edge',
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
        title: 'Floor dragging resulting in wrong package orientation',
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
        title: 'Fatigue drop risk from solo heavy lift',
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
      title: 'Warning sign leading to secondary hazard',
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
      title: 'Potential carton impact & drop damage',
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
      title: 'Worker ergonomic strain & injury risk',
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
      title: 'Packaging abrasion & floor drag damage',
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
      title: 'Escalating load instability hazard',
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

function getHumanPatternStory(pat) {
  const patternType = pat.pattern_type
  const scenarioKey = pat.scenario || ''
  const config = getScenarioConfig(scenarioKey)
  const count = pat.event_count || 1
  const durationSec = Math.round(pat.time_window_sec || 0)

  if (patternType === 'repeated_behaviour') {
    let title = config.title
    if (scenarioKey === 'entity_in_dock_edge_zone') {
      title = 'Workers repeatedly in unsafe dock-edge area'
    } else if (scenarioKey === 'entity_in_wet_floor_zone') {
      title = 'Cargo handled repeatedly in marked wet floor zone'
    } else if (scenarioKey === 'dragging_precursor') {
      title = 'Packages dragged across floor multiple times'
    } else if (scenarioKey === 'stepping_on_carton') {
      title = 'Worker stepping directly onto cartons'
    } else if (scenarioKey === 'straps_as_handles') {
      title = 'Workers frequently using straps as handles'
    }

    return {
      title,
      badgeLabel: 'unsafe behaviour repeated',
      badgeStyle: 'border-signal/40 bg-signal/10 text-[#8a5f00]',
      whatWeSaw: `This unsafe action was detected ${count} times within ${durationSec > 0 ? `${durationSec} seconds` : 'the observation window'}.`,
      whyItMatters: `${config.whyItMatters} Because this happened repeatedly rather than as an isolated slip, it suggests a recurring habit that requires supervisor intervention.`,
      recommendedResponse: config.recommendedAction,
      trendText: pat.score_trend === 'escalating' ? 'Risk severity is increasing' : 'Consistent recurring frequency',
    }
  }

  if (patternType === 'escalating_risk') {
    return {
      title: 'Handling risk severity steadily increasing',
      badgeLabel: 'risk is increasing',
      badgeStyle: 'border-danger/40 bg-danger/10 text-danger',
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
      badgeLabel: 'warning sign sequence',
      badgeStyle: 'border-steel/40 bg-steel/10 text-steel',
      whatWeSaw: `A warning sign (${preConfig.title.toLowerCase()}) occurred, followed by a secondary hazard within ${durationSec} seconds.`,
      whyItMatters: 'The first unsafe handling practice directly created the mechanical conditions for the second hazard to occur.',
      recommendedResponse: `Correct the initial practice: ${preConfig.recommendedAction}`,
      trendText: 'Hazard sequence detected',
    }
  }

  return {
    title: config.title || 'Operational sequence pattern',
    badgeLabel: 'pattern detected',
    badgeStyle: 'border-line bg-paper text-ink-soft',
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
  const [activeTab, setActiveTab] = useState('predictions')
  const [windowSec, setWindowSec] = useState(300)
  const [patternsData, setPatternsData] = useState(null)
  const [predictiveData, setPredictiveData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [collapsed, setCollapsed] = useState(false)
  const [expandedEvidence, setExpandedEvidence] = useState({})

  const toggleEvidence = (id) => {
    setExpandedEvidence((prev) => ({ ...prev, [id]: !prev[id] }))
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
    <div className="flex flex-col border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-ink p-4">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 animate-pulse motion-reduce:animate-none bg-signal" />
          <div>
            <h3 className="font-display text-display-md font-semibold text-paper">
              early warning & operational patterns
            </h3>
            <p className="mt-0.5 text-caption text-paper/60">
              TRACE watches sequences of actions across the shift to spot repeating unsafe habits
              and forecast potential damage before it happens.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 border border-paper/20 bg-ink px-2 py-1">
            <span className="text-caption text-paper/60">time scope</span>
            <select
              value={windowSec}
              onChange={(e) => setWindowSec(Number(e.target.value))}
              className="bg-transparent text-caption font-medium text-paper focus:outline-none"
            >
              <option value={60}>last 1 min</option>
              <option value={120}>last 2 mins</option>
              <option value={300}>last 5 mins</option>
              <option value={900}>last 15 mins</option>
              <option value={3600}>entire shift</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="border border-paper/20 px-2 py-1 text-caption text-paper/80 transition-colors hover:text-paper"
          >
            {collapsed ? 'show' : 'minimize'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-4 py-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('predictions')}
                className={`flex items-center gap-2 border px-3 py-1.5 text-caption font-medium transition-colors ${
                  activeTab === 'predictions'
                    ? 'border-ink bg-ink text-paper'
                    : 'border-line bg-surface text-ink-soft hover:text-ink'
                }`}
              >
                what may happen
                <span className="font-mono text-label">{predictionCount}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('patterns')}
                className={`flex items-center gap-2 border px-3 py-1.5 text-caption font-medium transition-colors ${
                  activeTab === 'patterns'
                    ? 'border-ink bg-ink text-paper'
                    : 'border-line bg-surface text-ink-soft hover:text-ink'
                }`}
              >
                repeated actions
                <span className="font-mono text-label">{patternCount}</span>
              </button>
            </div>
          </div>

          <div className="p-4">
            {loading && (
              <div className="flex items-center justify-center gap-2.5 p-8 text-small text-ink-soft">
                <span className="h-4 w-4 animate-spin motion-reduce:animate-none border-2 border-ink border-t-transparent" />
                analyzing sequences and checking for repeating safety patterns…
              </div>
            )}

            {!loading && error && (
              <div className="flex items-center gap-2 border border-danger bg-danger/5 p-3 text-small text-danger">
                <span className="font-medium">notice:</span> {error}
              </div>
            )}

            {!loading && !error && activeTab === 'predictions' && (
              <div className="flex flex-col gap-4">
                {predictionCount === 0 ? (
                  <EmptyState title="No compounding safety risks detected">
                    Current observations show isolated events without multi-step escalation or
                    repeating warning signs in this time scope. TRACE only generates early warnings
                    when genuine repeating patterns are observed.
                  </EmptyState>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {consolidatedPredictions.map((pred) => {
                      const story = getHumanPredictionStory(pred)
                      const isExpanded = Boolean(expandedEvidence[pred.prediction_id])
                      const eventCount = pred.supporting_event_ids?.length || 1

                      return (
                        <div key={pred.prediction_id} className="flex flex-col justify-between gap-3 border border-line bg-surface p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="border border-steel/40 bg-steel/10 px-2 py-0.5 text-label font-medium text-steel">
                                likely risk
                              </span>
                              <span className={`border px-2 py-0.5 text-label font-medium ${SEVERITY_BADGE[pred.predicted_band] || SEVERITY_BADGE.Medium}`}>
                                {pred.predicted_band} risk
                              </span>
                              <span className="text-caption text-ink-soft">
                                certainty: <span className="font-medium text-ink">{pred.confidence}</span>
                              </span>
                            </div>
                            <span className="font-mono text-caption text-ink-faint">
                              {eventCount} {eventCount === 1 ? 'observation' : 'observations'}
                            </span>
                          </div>

                          <h4 className="text-title font-semibold leading-snug text-ink">{story.title}</h4>

                          <div className="flex flex-col gap-2">
                            <StoryBlock label="what we saw" tone="neutral" text={story.whatWeSaw} />
                            <StoryBlock label="why it matters" tone="signal" text={story.whyItMatters} />
                            <StoryBlock label="what may happen" tone="steel" text={story.whatMayHappen} footer={`when: ${story.when}`} />
                            <StoryBlock label="recommended response" tone="ok" text={story.recommendedResponse} strong />
                          </div>

                          <div className="border-t border-line pt-2">
                            <button
                              type="button"
                              onClick={() => toggleEvidence(pred.prediction_id)}
                              className="flex w-full items-center justify-between py-1 text-caption text-ink-soft hover:text-ink"
                            >
                              <span className="font-medium">evidence & derivation ({eventCount} events)</span>
                              <span className="font-mono">{isExpanded ? '−' : '+'}</span>
                            </button>

                            {isExpanded && (
                              <div className="mt-2 flex flex-col gap-2.5 border border-line bg-paper p-3">
                                <div>
                                  <span className="text-label font-medium text-ink-soft">how TRACE reached this conclusion</span>
                                  <div className="mt-1 flex flex-col gap-1">
                                    {story.derivationChain.map((step, idx) => (
                                      <div key={idx} className="flex items-start gap-1.5 text-caption leading-relaxed">
                                        <span className="font-mono font-medium text-ink-faint">{idx + 1}.</span>
                                        <span className={idx === 2 ? 'font-medium text-steel' : 'text-ink-soft'}>{step}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="flex flex-col gap-1 border-t border-line pt-2">
                                  <span className="text-label font-medium text-ink-soft">supporting events</span>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {pred.supporting_event_ids.map((eid) => (
                                      <button
                                        key={eid}
                                        type="button"
                                        onClick={() => onSelectEvent && onSelectEvent(eid)}
                                        className="border border-line bg-surface px-2 py-0.5 font-mono text-caption font-medium text-ink transition-colors hover:border-ink"
                                      >
                                        #{eid}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div className="border-t border-line pt-1 text-caption italic text-ink-faint">
                                  Early warning signal grounded in real video detections. This hazard
                                  has not yet resulted in physical damage.
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

            {!loading && !error && activeTab === 'patterns' && (
              <div className="flex flex-col gap-4">
                {patternCount === 0 ? (
                  <EmptyState title="No repeating behaviour patterns detected">
                    TRACE requires at least two correlating handling actions within the time scope
                    to identify a recurring behavioural pattern.
                  </EmptyState>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {consolidatedPatterns.map((pat, idx) => {
                      const story = getHumanPatternStory(pat)
                      const cardId = `pattern_${idx}_${pat.scenario}`
                      const isExpanded = Boolean(expandedEvidence[cardId])
                      const eventCount = pat.supporting_event_ids?.length || 1

                      return (
                        <div key={cardId} className="flex flex-col justify-between gap-3 border border-line bg-surface p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`border px-2 py-0.5 text-label font-medium ${story.badgeStyle}`}>
                                {story.badgeLabel}
                              </span>
                              <span className="border border-line bg-paper px-2 py-0.5 text-label text-ink-soft">
                                {story.trendText}
                              </span>
                              {pat.peak_score != null && (
                                <span className="font-mono text-caption text-ink-soft">
                                  peak: <span className="font-medium text-ink">{Math.round(pat.peak_score)}/100</span>
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-caption text-ink-faint">
                              {eventCount} {eventCount === 1 ? 'event' : 'events'}
                            </span>
                          </div>

                          <h4 className="text-title font-semibold leading-snug text-ink">{story.title}</h4>

                          <div className="flex flex-col gap-2">
                            <StoryBlock label="what we saw" tone="neutral" text={story.whatWeSaw} />
                            <StoryBlock label="why this matters" tone="signal" text={story.whyItMatters} />
                            <StoryBlock label="recommended response" tone="ok" text={story.recommendedResponse} strong />
                          </div>

                          <div className="border-t border-line pt-2">
                            <button
                              type="button"
                              onClick={() => toggleEvidence(cardId)}
                              className="flex w-full items-center justify-between py-1 text-caption text-ink-soft hover:text-ink"
                            >
                              <span className="font-medium">evidence details ({eventCount} events)</span>
                              <span className="font-mono">{isExpanded ? '−' : '+'}</span>
                            </button>

                            {isExpanded && (
                              <div className="mt-2 flex flex-col gap-2 border border-line bg-paper p-3">
                                <span className="text-label font-medium text-ink-soft">supporting events</span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {pat.supporting_event_ids.map((eid) => (
                                    <button
                                      key={eid}
                                      type="button"
                                      onClick={() => onSelectEvent && onSelectEvent(eid)}
                                      className="border border-line bg-surface px-2 py-0.5 font-mono text-caption font-medium text-ink transition-colors hover:border-ink"
                                    >
                                      #{eid}
                                    </button>
                                  ))}
                                </div>
                                <div className="border-t border-line pt-1 text-caption italic text-ink-faint">
                                  Derived deterministically from consecutive video analysis detections
                                  across the specified time scope.
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

function EmptyState({ title, children }) {
  return (
    <div className="border border-dashed border-line-strong p-6 text-center">
      <p className="text-title font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-small text-ink-soft">{children}</p>
    </div>
  )
}

function StoryBlock({ label, tone, text, footer, strong }) {
  const toneCls = {
    neutral: 'border-line bg-paper',
    signal: 'border-signal/40 bg-signal/5',
    steel: 'border-steel/40 bg-steel/5',
    ok: 'border-ok/40 bg-ok/5',
  }[tone]
  const labelCls = {
    neutral: 'text-ink-faint',
    signal: 'text-[#8a5f00]',
    steel: 'text-steel',
    ok: 'text-ok',
  }[tone]
  return (
    <div className={`border p-2.5 ${toneCls}`}>
      <span className={`block text-label font-medium ${labelCls}`}>{label}</span>
      <p className={`mt-0.5 text-caption leading-relaxed ${tone === 'neutral' ? 'text-ink-soft' : 'text-ink'} ${strong ? 'font-medium' : ''}`}>
        {text}
      </p>
      {footer && (
        <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5 text-caption text-ink-faint">
          <span>{footer}</span>
        </div>
      )}
    </div>
  )
}
