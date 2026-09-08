import { useState } from 'react'
import { ArrowRight, ArrowUpRight, Check, Crosshair, Layers, ShieldAlert } from 'lucide-react'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import {
  CANONICAL_14_SCENARIOS,
  CANONICAL_VIDEO_MAPPINGS,
  RISK_BAND_STYLES,
} from '../lib/scenarios.js'

export default function ScenarioCoverage() {
  const { navigateTo } = useLiveViewContext()
  const [activeTab, setActiveTab] = useState('videos')
  const [expandedScenarios, setExpandedScenarios] = useState({ 1: true, 8: true, 13: true })

  const toggleExpand = (num) => {
    setExpandedScenarios((prev) => ({ ...prev, [num]: !prev[num] }))
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
    <div className="flex flex-col gap-8">
      {/* header */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <p className="mb-2 flex items-center gap-2 text-label font-medium text-ink-soft">
            <Crosshair size={13} />
            operational intelligence
          </p>
          <h1 className="font-display text-display-lg font-semibold text-ink">
            Scenario coverage &amp; multi-lens video intelligence
          </h1>
          <p className="mt-3 max-w-2xl text-body text-ink-soft">
            Seven canonical warehouse videos, fourteen operational safety scenarios, four
            independent risk lenses. A single feed can contain several overlapping hazards —
            TRACE reasons through all of them at once.
          </p>
        </div>
        <div className="lg:col-span-4">
          <div className="flex flex-wrap gap-2">
            <span className="border border-line bg-surface px-3 py-1.5 font-mono text-caption text-ink-soft">
              7 videos
            </span>
            <span className="border border-line bg-surface px-3 py-1.5 font-mono text-caption text-ink-soft">
              14 scenarios
            </span>
            <span className="border border-line bg-surface px-3 py-1.5 font-mono text-caption text-ink-soft">
              4 lenses
            </span>
          </div>
        </div>
      </section>

      {/* metrics — asymmetric */}
      <section className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-4">
        {[
          { n: '14', label: 'operational scenarios', sub: 'architecture §9' },
          { n: '7', label: 'canonical videos', sub: 'distinct cameras' },
          { n: '4', label: 'independent risk lenses', sub: 'structural · conformance · behaviour · environmental' },
          { n: '13', label: 'demonstrated in footage', sub: 'one rule-ready', tone: 'ok' },
        ].map((m) => (
          <div key={m.label} className="bg-surface p-5">
            <span className={`font-display text-display-lg font-semibold tabular-nums ${m.tone === 'ok' ? 'text-ok' : 'text-ink'}`}>
              {m.n}
            </span>
            <p className="mt-1 text-small font-medium text-ink">{m.label}</p>
            <p className="text-caption text-ink-faint">{m.sub}</p>
          </div>
        ))}
      </section>

      {/* epistemic notice */}
      <section className="flex items-start gap-3 border border-signal/40 bg-signal/5 p-4">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-[#8a5f00]" />
        <p className="text-small text-ink-soft">
          <span className="font-semibold text-ink">Epistemic transparency.</span> Thirteen of the
          fourteen scenarios are demonstrated in the challenge footage. Scenario 13 (wrong
          equipment usage) is implemented with validated conformance logic and regression tests,
          but the dataset contains no equipment mismatch — TRACE reports it as rule-ready rather
          than fabricating a detection.
        </p>
      </section>

      {/* tabs */}
      <div className="flex items-center justify-between border-b border-line">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setActiveTab('videos')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-small font-medium transition-colors ${
              activeTab === 'videos'
                ? 'border-ink text-ink'
                : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            <Layers size={14} />
            videos → findings ({CANONICAL_VIDEO_MAPPINGS.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scenarios')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-small font-medium transition-colors ${
              activeTab === 'scenarios'
                ? 'border-ink text-ink'
                : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            <Crosshair size={14} />
            all scenarios ({CANONICAL_14_SCENARIOS.length})
          </button>
        </div>
        <span className="hidden font-mono text-caption text-ink-faint md:inline">
          {activeTab === 'videos' ? 'one video → many interpretations' : 'full specification'}
        </span>
      </div>

      {/* videos tab */}
      {activeTab === 'videos' && (
        <div className="flex flex-col gap-6">
          {CANONICAL_VIDEO_MAPPINGS.map((vid) => (
            <div key={vid.videoId} className="border border-line bg-surface">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="bg-ink px-2 py-0.5 font-mono text-label font-semibold text-paper">
                      {vid.tag}
                    </span>
                    <h2 className="text-title font-semibold text-ink">{vid.cameraName}</h2>
                    <span className="text-caption text-ink-soft">· {vid.zone}</span>
                  </div>
                  <p className="mt-1.5 text-small text-ink-soft">{vid.description}</p>
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
                  <div key={scen.key} className="flex flex-col gap-3 bg-paper p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-label text-ink-faint">
                        scenario #{scen.number}
                      </span>
                      <span className="border border-line bg-surface px-2 py-0.5 text-label text-ink-soft">
                        {scen.lens}
                      </span>
                    </div>
                    <h3 className="text-small font-semibold leading-snug text-ink">{scen.title}</h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`border px-2 py-0.5 text-label font-medium ${
                          RISK_BAND_STYLES[scen.band]?.subtle || ''
                        }`}
                      >
                        {RISK_BAND_STYLES[scen.band]?.label || scen.band}
                      </span>
                      <span className="border border-line bg-surface px-2 py-0.5 font-mono text-label text-ink-soft">
                        {scen.epistemicLevel}
                      </span>
                      {scen.whatIfEligible ? (
                        <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label text-ok">
                          what-if available
                        </span>
                      ) : (
                        <span className="border border-line bg-paper px-2 py-0.5 text-label text-ink-faint">
                          procedural action
                        </span>
                      )}
                    </div>
                    <p className="text-caption text-ink-soft">{scen.summary}</p>
                    <div className="mt-auto flex items-center justify-between border-t border-line pt-2">
                      <span className="font-mono text-caption text-ink-faint">
                        {scen.timestamp ? `t = ${scen.timestamp.toFixed(1)}s` : 'timestamped'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleReplay({ ...scen, videoId: vid.videoId })}
                        className="inline-flex items-center gap-1 text-small font-medium text-ink hover:underline"
                      >
                        replay incident
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* scenarios tab */}
      {activeTab === 'scenarios' && (
        <div className="flex flex-col gap-3">
          {CANONICAL_14_SCENARIOS.map((scen) => {
            const isExpanded = !!expandedScenarios[scen.number]
            const isDemonstrated = scen.status === 'DEMONSTRATED'

            return (
              <div
                key={scen.number}
                className={`border ${isDemonstrated ? 'border-line bg-surface' : 'border-signal/40 bg-signal/5'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="bg-ink px-1.5 py-0.5 font-mono text-label font-semibold text-paper">
                        #{String(scen.number).padStart(2, '0')}
                      </span>
                      <h3 className="text-title font-semibold text-ink">{scen.title}</h3>
                      <span className="border border-line bg-paper px-2 py-0.5 text-label text-ink-soft">
                        {scen.lens} lens
                      </span>
                      <span
                        className={`border px-2 py-0.5 text-label font-medium ${
                          RISK_BAND_STYLES[scen.band]?.subtle || ''
                        }`}
                      >
                        {RISK_BAND_STYLES[scen.band]?.label || scen.band}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-soft">
                      {isDemonstrated ? (
                        <span className="inline-flex items-center gap-1.5 text-ok">
                          <Check size={13} />
                          demonstrated in {scen.videoTag} ({scen.videoName})
                          {scen.secondaryVideo && (
                            <span className="text-ink-faint">and {scen.secondaryVideo}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[#8a5f00]">rule-ready — no equipment violation in footage</span>
                      )}
                      <span className="font-mono">epistemic: {scen.epistemicLevel}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExpand(scen.number)}
                      className="border border-line bg-paper px-2.5 py-1 text-caption text-ink-soft transition-colors hover:text-ink"
                    >
                      {isExpanded ? 'hide details' : 'perception & reasoning'}
                    </button>
                    {isDemonstrated ? (
                      <button
                        type="button"
                        onClick={() => handleReplay(scen)}
                        className="inline-flex items-center gap-1.5 bg-ink px-3 py-1 text-caption font-semibold text-paper transition-colors hover:bg-ink-soft"
                      >
                        replay incident
                        <ArrowRight size={13} />
                      </button>
                    ) : (
                      <span className="font-mono text-caption text-ink-faint">
                        tested via regression suite
                      </span>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="grid grid-cols-1 gap-px border-t border-line bg-line md:grid-cols-4">
                    <div className="bg-paper p-3">
                      <span className="text-label font-medium text-ink-faint">what TRACE observed</span>
                      <p className="mt-1 text-caption text-ink-soft">{scen.observed}</p>
                    </div>
                    <div className="bg-paper p-3">
                      <span className="text-label font-medium text-ink-faint">epistemic inference</span>
                      <p className="mt-1 text-caption text-ink-soft">{scen.inferred}</p>
                    </div>
                    <div className="bg-paper p-3">
                      <span className="text-label font-medium text-ink-faint">risk classification</span>
                      <p className="mt-1 text-caption font-medium text-ink">{scen.riskTitle}</p>
                      <p className="mt-1 text-caption text-ink-faint">
                        {scen.status === 'DEMONSTRATED' ? 'probable / supported' : 'rule-ready'}
                      </p>
                    </div>
                    <div className="bg-paper p-3">
                      <span className="text-label font-medium text-ok">safe action intervention</span>
                      <p className="mt-1 text-caption text-ink">{scen.recommendedAction}</p>
                      {scen.whatIfNotice && (
                        <p className="mt-1 text-caption italic text-ink-faint">{scen.whatIfNotice}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
