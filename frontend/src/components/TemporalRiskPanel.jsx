import { useEffect, useState, useMemo } from 'react'
import { getTemporalPatterns, getPredictiveRisk } from '../api/temporal.js'

const BAND_BADGE = {
  Critical: 'border-red-400 bg-red-50 text-red-800',
  High: 'border-orange-300 bg-orange-50 text-orange-800',
  Medium: 'border-amber-300 bg-amber-50 text-amber-800',
  Low: 'border-neutral-300 bg-neutral-50 text-neutral-700',
}

const TREND_BADGE = {
  escalating: 'bg-red-100 text-red-800 border-red-200',
  'de-escalating': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  stable: 'bg-neutral-100 text-neutral-700 border-neutral-200',
  variable: 'bg-amber-100 text-amber-800 border-amber-200',
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
      setError(err.message || 'Failed to evaluate temporal risk.')
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

    return Array.from(groups.values()).map((g) => ({
      ...g,
      supporting_event_ids: Array.from(g.allEventIds).sort((a, b) => a - b),
      occurrenceCount: g.instances.length,
    }))
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
      {/* Panel Header */}
      <div className="border-b border-line p-3.5 bg-neutral-900 text-white flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                Temporal Reasoning &amp; Predictive Risk Engine
              </span>
              <span className="text-[9px] font-bold bg-neutral-800 text-neutral-300 border border-neutral-700 px-1.5 py-0.2">
                FEATURES 1 &amp; 2
              </span>
            </div>
            <span className="text-[10px] text-neutral-400">
              Correlates multi-event observation sequences &amp; forecasts forward risk with verifiable derivation chains.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Window Selector */}
          <div className="flex items-center gap-1 text-[10px] text-neutral-300">
            <span>Window:</span>
            <select
              value={windowSec}
              onChange={(e) => setWindowSec(Number(e.target.value))}
              className="bg-neutral-800 border border-neutral-700 text-white px-1.5 py-0.5 text-[10px] focus:outline-none"
            >
              <option value={60}>60s</option>
              <option value={120}>120s</option>
              <option value={300}>300s (5m)</option>
              <option value={900}>900s (15m)</option>
              <option value={3600}>1 hr</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="text-neutral-400 hover:text-white px-2 py-0.5 text-xs font-mono cursor-pointer"
            title={collapsed ? 'Expand panel' : 'Collapse panel'}
          >
            {collapsed ? '[+ Expand]' : '[- Collapse]'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Subheader / Tabs */}
          <div className="flex items-center justify-between border-b border-line bg-neutral-50 px-3 py-2 text-xs flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('predictions')}
                className={`px-3 py-1 font-bold text-xs border transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'predictions'
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <span>Predictive Risk Forecasts</span>
                <span className="px-1.5 py-0.2 text-[10px] bg-purple-200 text-purple-900 font-mono font-bold">
                  {predictionCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('patterns')}
                className={`px-3 py-1 font-bold text-xs border transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'patterns'
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                <span>Inferred Temporal Sequences</span>
                <span className="px-1.5 py-0.2 text-[10px] bg-amber-200 text-amber-900 font-mono font-bold">
                  {patternCount}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-neutral-500">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <strong className="text-neutral-700">OBSERVED:</strong> Events
              </span>
              <span>→</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <strong className="text-neutral-700">INFERRED:</strong> Sequence
              </span>
              <span>→</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                <strong className="text-neutral-700">PREDICTED:</strong> Forecast
              </span>
            </div>
          </div>

          {/* Body Content */}
          <div className="p-4">
            {loading && (
              <div className="p-6 text-center text-xs text-neutral-500 flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-neutral-800 border-t-transparent animate-spin" />
                <span>Analysing temporal event chains and generating risk forecasts...</span>
              </div>
            )}

            {!loading && error && (
              <div className="p-3 text-xs bg-red-50 border border-red-200 text-red-800">
                <strong>Analysis Warning:</strong> {error}
              </div>
            )}

            {/* TAB: PREDICTIONS */}
            {!loading && !error && activeTab === 'predictions' && (
              <div className="flex flex-col gap-3">
                {predictionCount === 0 ? (
                  <div className="border border-dashed border-line p-4 text-center text-xs text-neutral-500">
                    <p className="font-semibold text-neutral-700 mb-1">
                      No Predictive Risk Anomalies Detected in Current Window
                    </p>
                    <p className="text-[11px] text-neutral-500 max-w-xl mx-auto">
                      {predictiveData?.insufficient_evidence_reason ||
                        'Current observed temporal sequences do not meet the minimum event density or escalation criteria to justify forward prediction.'}
                    </p>
                    <p className="text-[10px] text-neutral-400 mt-2 italic">
                      Epistemic Safeguard: TRACE never invents risk forecasts when underlying event evidence is insufficient.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {consolidatedPredictions.map((pred) => (
                      <div
                        key={pred.prediction_id}
                        className="border border-purple-200 bg-purple-50/30 p-3.5 flex flex-col gap-2.5 hover:border-purple-300 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-1.5 py-0.5 text-[9px] font-bold border border-purple-300 bg-purple-100 text-purple-900 tracking-wider">
                              PREDICTED
                            </span>
                            <span
                              className={`px-1.5 py-0.5 text-[9px] font-bold border ${
                                BAND_BADGE[pred.predicted_band] || 'border-neutral-300'
                              }`}
                            >
                              {pred.predicted_band.toUpperCase()} RISK
                            </span>
                            <span className="text-[10px] text-neutral-500 font-mono">
                              Conf: <strong>{pred.confidence}</strong>
                            </span>
                            {pred.occurrenceCount > 1 && (
                              <span className="text-[9px] bg-purple-100 text-purple-800 border border-purple-200 px-1 py-0.2 font-mono">
                                {pred.occurrenceCount} correlated observations
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] font-mono text-neutral-400">
                            ID: {pred.prediction_id}
                          </span>
                        </div>

                        <div>
                          <h4 className="text-xs font-bold text-neutral-900 uppercase tracking-tight">
                            {pred.predicted_scenario.replace(/_/g, ' ')}
                          </h4>
                          <p className="text-[11px] text-neutral-700 mt-1 leading-snug">
                            {pred.explanation}
                          </p>
                        </div>

                        {/* Forecast Horizon */}
                        <div className="text-[10px] bg-white border border-purple-200 p-2 text-neutral-700 flex items-center justify-between">
                          <span className="font-semibold text-purple-950">Forecast Horizon:</span>
                          <span className="italic text-neutral-600">{pred.horizon_description}</span>
                        </div>

                        {/* Reasoning Chain */}
                        <div className="border border-line/60 bg-white/80 p-2 text-[10px] flex flex-col gap-1">
                          <span className="font-bold text-[9px] uppercase tracking-wider text-neutral-500">
                            Verifiable Derivation Chain:
                          </span>
                          {pred.prediction_chain.map((step, idx) => (
                            <div key={idx} className="flex items-start gap-1 font-mono text-[10px]">
                              <span className="text-neutral-400">{idx + 1}.</span>
                              <span
                                className={
                                  idx === 0
                                    ? 'text-emerald-800'
                                    : idx === 1
                                    ? 'text-amber-800'
                                    : 'text-purple-900 font-semibold'
                                }
                              >
                                {step}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Supporting Events clickable */}
                        <div className="flex items-center gap-1.5 flex-wrap text-[10px] pt-1 border-t border-purple-100">
                          <span className="text-neutral-500 font-medium">Supporting Evidence:</span>
                          {pred.supporting_event_ids.map((eid) => (
                            <button
                              key={eid}
                              type="button"
                              onClick={() => onSelectEvent && onSelectEvent(eid)}
                              className="px-1.5 py-0.5 bg-white border border-neutral-300 text-neutral-800 font-mono hover:bg-neutral-100 cursor-pointer"
                              title={`Inspect event #${eid} in audit log`}
                            >
                              #{eid}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB: TEMPORAL PATTERNS */}
            {!loading && !error && activeTab === 'patterns' && (
              <div className="flex flex-col gap-3">
                {patternCount === 0 ? (
                  <div className="border border-dashed border-line p-4 text-center text-xs text-neutral-500">
                    <p className="font-semibold text-neutral-700 mb-1">
                      No Multi-Event Temporal Patterns Identified
                    </p>
                    <p className="text-[11px] text-neutral-500 max-w-xl mx-auto">
                      {patternsData?.insufficient_evidence_reason ||
                        'Requires at least 2 correlating operational events within the window to construct a sequence.'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {consolidatedPatterns.map((pat, idx) => (
                      <div
                        key={idx}
                        className="border border-amber-200 bg-amber-50/20 p-3.5 flex flex-col gap-2.5 hover:border-amber-300 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-1.5 py-0.5 text-[9px] font-bold border border-amber-300 bg-amber-100 text-amber-900 tracking-wider">
                              INFERRED
                            </span>
                            <span
                              className={`px-1.5 py-0.5 text-[9px] font-bold border ${
                                TREND_BADGE[pat.score_trend] || 'border-neutral-300'
                              }`}
                            >
                              TREND: {pat.score_trend.toUpperCase()}
                            </span>
                            {pat.peak_score != null && (
                              <span className="text-[10px] text-neutral-600 font-mono">
                                Peak: <strong>{pat.peak_score.toFixed(0)}</strong>
                              </span>
                            )}
                            {pat.occurrenceCount > 1 && (
                              <span className="text-[9px] bg-amber-100 text-amber-800 border border-amber-200 px-1 py-0.2 font-mono">
                                {pat.occurrenceCount} instances
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-neutral-500 font-mono tabular-nums">
                            Δ {pat.time_window_sec.toFixed(1)}s
                          </span>
                        </div>

                        <div>
                          <h4 className="text-xs font-bold text-neutral-900 uppercase tracking-tight">
                            {pat.label}
                          </h4>
                          <p className="text-[11px] text-neutral-700 mt-1 leading-snug">
                            {pat.description}
                          </p>
                        </div>

                        {/* Supporting Events list */}
                        <div className="flex items-center gap-1.5 flex-wrap text-[10px] pt-1 border-t border-amber-100">
                          <span className="text-neutral-500 font-medium">
                            Sequence ({pat.event_count} events):
                          </span>
                          {pat.supporting_event_ids.map((eid) => (
                            <button
                              key={eid}
                              type="button"
                              onClick={() => onSelectEvent && onSelectEvent(eid)}
                              className="px-1.5 py-0.5 bg-white border border-neutral-300 text-neutral-800 font-mono hover:bg-neutral-100 cursor-pointer"
                              title={`Inspect event #${eid} in audit log`}
                            >
                              #{eid}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
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
