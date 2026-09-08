import { useState } from 'react'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import {
  CANONICAL_14_SCENARIOS,
  CANONICAL_VIDEO_MAPPINGS,
  RISK_BAND_STYLES,
} from '../lib/scenarios.js'

const LENS_STYLES = {
  Structural: 'border-sky-300 bg-sky-50 text-sky-800',
  Behaviour: 'border-purple-300 bg-purple-50 text-purple-800',
  'Behaviour & Structural': 'border-purple-400 bg-purple-50 text-purple-900',
  Conformance: 'border-indigo-300 bg-indigo-50 text-indigo-800',
  Environmental: 'border-emerald-300 bg-emerald-50 text-emerald-800',
}

export default function ScenarioCoverage() {
  const { navigateTo } = useLiveViewContext()
  const [activeTab, setActiveTab] = useState('videos') // 'videos' | 'scenarios'
  const [expandedScenarios, setExpandedScenarios] = useState({ 1: true, 8: true, 13: true })

  const toggleExpand = (num) => {
    setExpandedScenarios((prev) => ({
      ...prev,
      [num]: !prev[num],
    }))
  }

  const handleReplay = (item) => {
    if (!item.videoId) return
    navigateTo('Incident Replay', {
      eventId: item.presetId || null,
      videoId: item.videoId,
      timestamp: item.timestamp || 0,
    })
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* 1. HEADER */}
      <div className="border border-line bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-neutral-900 text-white">
                Operational Intelligence
              </span>
              <span className="text-xs font-mono text-neutral-500">
                ARCHITECTURE.md §9 Coverage
              </span>
            </div>
            <h1 className="text-xl font-bold text-neutral-950">
              Scenario Coverage & Multi-Lens Video Intelligence
            </h1>
            <p className="text-xs text-neutral-600 leading-relaxed max-w-3xl">
              See how TRACE transforms 7 canonical warehouse videos into 14 operational safety scenarios across independent perception lenses.
            </p>
          </div>

          {/* Quick Flow Breadcrumb */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-neutral-500 bg-neutral-50 p-2.5 border border-line flex-wrap">
            <span className="font-bold text-neutral-900">7 Videos</span>
            <span>➔</span>
            <span className="font-bold text-neutral-900">14 Scenarios</span>
            <span>➔</span>
            <span className="text-neutral-700">Perception</span>
            <span>➔</span>
            <span className="text-neutral-700">Reasoning</span>
            <span>➔</span>
            <span className="text-neutral-700">Risk</span>
            <span>➔</span>
            <span className="font-bold text-emerald-700">Safe Action</span>
          </div>
        </div>

        {/* Top 4 Concise Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-5 border-t border-line">
          <div className="border border-line bg-neutral-50/70 p-3.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
              Operational Scenarios
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-bold font-mono text-neutral-950">14</span>
              <span className="text-[11px] text-neutral-500 font-medium">Architecture §9</span>
            </div>
          </div>

          <div className="border border-line bg-neutral-50/70 p-3.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
              Canonical Videos
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-bold font-mono text-neutral-950">7</span>
              <span className="text-[11px] text-neutral-500 font-medium">Distinct Cameras</span>
            </div>
          </div>

          <div className="border border-line bg-neutral-50/70 p-3.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
              Independent Risk Lenses
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-bold font-mono text-neutral-950">4</span>
              <span className="text-[11px] text-neutral-500 font-medium">Structural / Conformance / Behaviour / Environmental</span>
            </div>
          </div>

          <div className="border border-line bg-neutral-50/70 p-3.5 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
              Video-Demonstrated
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-bold font-mono text-emerald-700">13</span>
              <span className="text-[11px] text-neutral-500 font-medium">In Challenge Footage</span>
            </div>
          </div>
        </div>

        {/* Honest Epistemic Disclaimer Alert */}
        <div className="mt-4 p-3 bg-amber-50/80 border border-amber-300/80 text-[11px] text-amber-900 flex items-start gap-2.5">
          <span className="text-sm shrink-0">🛡️</span>
          <div>
            <span className="font-bold">Epistemic Transparency Notice:</span>{' '}
            13 of the 14 operational scenarios are actively demonstrated in the 7 challenge video recordings.
            Scenario 13 (<span className="font-semibold">Wrong Equipment Usage</span>) is fully implemented with validated conformance logic and regression tests, but the challenge dataset contains no footage of an equipment mismatch. TRACE honestly reports it as <strong>Rule-Ready</strong> rather than fabricating video detections.
          </div>
        </div>
      </div>

      {/* 2. VIEW MODE TOGGLE TABS */}
      <div className="flex items-center justify-between border-b border-line pb-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('videos')}
            className={`px-4 py-2 text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border-b-2 ${
              activeTab === 'videos'
                ? 'border-neutral-950 text-neutral-950 bg-neutral-100/60'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <span>📹</span>
            <span>7 Canonical Videos → Multi-Scenario Findings ({CANONICAL_VIDEO_MAPPINGS.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scenarios')}
            className={`px-4 py-2 text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border-b-2 ${
              activeTab === 'scenarios'
                ? 'border-neutral-950 text-neutral-950 bg-neutral-100/60'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <span>📋</span>
            <span>All 14 Operational Scenarios Catalog ({CANONICAL_14_SCENARIOS.length})</span>
          </button>
        </div>
        <span className="text-[11px] font-mono text-neutral-500 pr-2">
          {activeTab === 'videos' ? 'Showing One Video ➔ Multiple Interpretations' : 'Full Architecture Specification'}
        </span>
      </div>

      {/* 3. TAB CONTENT: 7 VIDEOS MAPPING */}
      {activeTab === 'videos' && (
        <div className="space-y-4">
          <div className="bg-neutral-50 border border-line p-3 text-[11px] text-neutral-600 flex items-center justify-between flex-wrap gap-2">
            <span>
              💡 <strong>Judge Insight:</strong> A single camera feed contains multiple overlapping hazards. TRACE uses 4 independent lenses simultaneously so structural stability, ergonomic behavior, and zone hazards are detected concurrently from the same frame sequence.
            </span>
            <span className="font-mono text-[10px] text-neutral-500">
              Total Monitored Cameras: 7
            </span>
          </div>

          <div className="space-y-4">
            {CANONICAL_VIDEO_MAPPINGS.map((vid) => (
              <div
                key={vid.videoId}
                className="border border-line bg-white p-5 shadow-xs space-y-4 hover:border-neutral-400 transition-colors"
              >
                {/* Video Header Row */}
                <div className="flex items-start justify-between border-b border-line/70 pb-3 flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-neutral-900 text-white uppercase">
                        {vid.tag}
                      </span>
                      <h2 className="text-sm font-bold text-neutral-950">
                        {vid.cameraName}
                      </h2>
                      <span className="text-[11px] text-neutral-500 font-medium">
                        • {vid.zone}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-600 mt-1 leading-relaxed">
                      {vid.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="px-2 py-0.5 text-[11px] font-mono bg-neutral-100 border border-neutral-300 text-neutral-700">
                      Duration: {vid.duration}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-50 border border-emerald-300 text-emerald-800">
                      {vid.scenarios.length} Operational Findings
                    </span>
                  </div>
                </div>

                {/* Video Scenarios Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                  {vid.scenarios.map((scen) => (
                    <div
                      key={scen.key}
                      className="border border-line bg-neutral-50/60 p-3.5 flex flex-col justify-between gap-3 hover:bg-white hover:border-neutral-400 transition-all shadow-2xs"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <span className="text-[10px] font-mono font-bold text-neutral-500">
                            Scenario #{scen.number}
                          </span>
                          <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase border ${LENS_STYLES[scen.lens] || 'border-line text-neutral-700'}`}>
                            {scen.lens} Lens
                          </span>
                        </div>

                        <h3 className="text-xs font-bold text-neutral-950 leading-snug">
                          {scen.title}
                        </h3>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase border ${RISK_BAND_STYLES[scen.band]?.subtle || 'border-neutral-300 text-neutral-700'}`}>
                            {scen.band} Risk
                          </span>
                          <span className="px-1.5 py-0.5 text-[9px] font-mono border border-neutral-300 bg-white text-neutral-700">
                            {scen.epistemicLevel}
                          </span>
                          {scen.whatIfEligible ? (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold border border-blue-300 bg-blue-50 text-blue-800">
                              What-If Available
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 text-[9px] font-medium border border-neutral-200 bg-neutral-100 text-neutral-600">
                              Procedural Action
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] text-neutral-600 leading-snug pt-1">
                          {scen.summary}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-line/60 flex items-center justify-between">
                        <span className="text-[10px] font-mono text-neutral-500">
                          {scen.timestamp ? `t = ${scen.timestamp.toFixed(1)}s` : 'Timestamped'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleReplay({ ...scen, videoId: vid.videoId })}
                          className="text-[11px] font-bold text-neutral-900 hover:text-black flex items-center gap-1 underline cursor-pointer"
                        >
                          <span>Replay Incident →</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. TAB CONTENT: ALL 14 SCENARIOS CATALOG */}
      {activeTab === 'scenarios' && (
        <div className="space-y-4">
          <div className="bg-neutral-50 border border-line p-3 text-[11px] text-neutral-600 flex items-center justify-between flex-wrap gap-2">
            <span>
              📋 <strong>Complete Scenario Matrix:</strong> All 14 operational scenarios defined in ARCHITECTURE.md §9. Every scenario includes epistemic attribution, deterministic risk banding, and safe action planner interventions.
            </span>
            <span className="font-mono text-[10px] text-neutral-500">
              13 Demonstrated • 1 Rule-Ready
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {CANONICAL_14_SCENARIOS.map((scen) => {
              const isExpanded = !!expandedScenarios[scen.number]
              const isDemonstrated = scen.status === 'DEMONSTRATED'

              return (
                <div
                  key={scen.number}
                  className={`border transition-all bg-white p-4 shadow-xs ${
                    isDemonstrated ? 'border-line hover:border-neutral-400' : 'border-amber-300/80 bg-amber-50/20'
                  }`}
                >
                  {/* Scenario Summary Card Header */}
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="space-y-1 max-w-2xl">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-neutral-900 text-white">
                          #{String(scen.number).padStart(2, '0')}
                        </span>
                        <h3 className="text-sm font-bold text-neutral-950">
                          {scen.title}
                        </h3>
                        <span className={`px-2 py-0.5 text-[9px] font-bold uppercase border ${LENS_STYLES[scen.lens] || 'border-line text-neutral-700'}`}>
                          {scen.lens} Lens
                        </span>
                        <span className={`px-2 py-0.5 text-[9px] font-bold uppercase border ${RISK_BAND_STYLES[scen.band]?.subtle || 'border-neutral-300 text-neutral-700'}`}>
                          {scen.band} Risk
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-neutral-600 flex-wrap pt-0.5">
                        {isDemonstrated ? (
                          <span className="flex items-center gap-1 text-emerald-800 font-semibold text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block" />
                            <span>Demonstrated in {scen.videoTag} ({scen.videoName})</span>
                            {scen.secondaryVideo && <span className="text-neutral-500 font-normal">and {scen.secondaryVideo}</span>}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-800 font-bold text-[11px] bg-amber-100 px-1.5 py-0.5 border border-amber-300">
                            <span>⚖️ Rule-Ready (No challenge footage contains an equipment violation)</span>
                          </span>
                        )}
                        <span className="text-neutral-400">•</span>
                        <span className="text-[11px] font-mono text-neutral-600">
                          Epistemic: <strong>{scen.epistemicLevel}</strong>
                        </span>
                        <span className="text-neutral-400">•</span>
                        <span className="text-[11px] text-neutral-600">
                          What-If:{' '}
                          {scen.whatIfEligible ? (
                            <strong className="text-blue-700">Available (Candidate Placements)</strong>
                          ) : (
                            <strong className="text-neutral-600">Not Applicable (Procedural / Ergonomic)</strong>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleExpand(scen.number)}
                        className="text-[11px] font-medium text-neutral-600 hover:text-neutral-950 px-2.5 py-1 border border-neutral-200 hover:border-neutral-400 bg-neutral-50 cursor-pointer"
                      >
                        {isExpanded ? 'Hide Details ▲' : 'Perception & Reasoning ▼'}
                      </button>

                      {isDemonstrated ? (
                        <button
                          type="button"
                          onClick={() => handleReplay(scen)}
                          className="text-[11px] font-bold text-white bg-neutral-900 hover:bg-black px-3 py-1 cursor-pointer flex items-center gap-1"
                        >
                          <span>Replay Incident</span>
                          <span>➔</span>
                        </button>
                      ) : (
                        <span className="text-[10px] font-mono text-amber-800 bg-amber-50 px-2 py-1 border border-amber-200">
                          Tested via Regression Suite
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Expandable Perception & Reasoning Drawer */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-line/70 grid grid-cols-1 md:grid-cols-4 gap-3 bg-neutral-50/50 p-3 text-xs">
                      {/* 1. WHAT TRACE OBSERVED */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                          <span>👁️ What TRACE Observed</span>
                        </div>
                        <p className="text-[11px] text-neutral-700 leading-relaxed">
                          {scen.observed}
                        </p>
                      </div>

                      {/* 2. WHY IT MATTERS (INFERRED) */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                          <span>🧠 Epistemic Inference</span>
                        </div>
                        <p className="text-[11px] text-neutral-700 leading-relaxed">
                          {scen.inferred}
                        </p>
                      </div>

                      {/* 3. DETERMINISTIC RISK */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                          <span>⚠️ Risk Classification</span>
                        </div>
                        <p className="text-[11px] font-semibold text-neutral-800 leading-relaxed">
                          {scen.riskTitle}
                        </p>
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase border ${RISK_BAND_STYLES[scen.band]?.subtle || 'border-line text-neutral-700'}`}>
                            {scen.band} Risk
                          </span>
                          <span className="text-[10px] font-mono text-neutral-500">
                            Status: {scen.status === 'DEMONSTRATED' ? 'Probable / Supported' : 'Rule-Ready'}
                          </span>
                        </div>
                      </div>

                      {/* 4. SAFE ACTION */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                          <span>⚡ Safe Action Intervention</span>
                        </div>
                        <p className="text-[11px] text-neutral-800 leading-relaxed font-medium">
                          {scen.recommendedAction}
                        </p>
                        {scen.whatIfNotice && (
                          <span className="text-[10px] text-neutral-500 block pt-0.5 italic">
                            Notice: {scen.whatIfNotice}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
