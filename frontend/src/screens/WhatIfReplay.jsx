import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  FileCheck,
  FlaskConical,
  Info,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { getSupportedWhatIfEvents, getSafetyWhatIfSimulation } from '../api/whatif.js'
import { streamUrl } from '../api/videos.js'
import { useLiveViewContext } from '../LiveViewContext.jsx'
import WorkflowNav from '../components/WorkflowNav.jsx'
import WhatIfScenarioVisualizer from '../components/video/WhatIfScenarioVisualizer.jsx'

const BAND_BADGES = {
  Low: 'border-ok/40 bg-ok/10 text-ok',
  Medium: 'border-signal/50 bg-signal/15 text-[#8a5f00]',
  High: 'border-danger/40 bg-danger/10 text-danger',
  Critical: 'border-danger bg-danger text-paper font-bold',
}

export default function WhatIfReplay() {
  const { replayTarget, navigateTo } = useLiveViewContext()

  const [supportedEvents, setSupportedEvents] = useState([])
  const [selectedBay, setSelectedBay] = useState('')
  const [selectedEventId, setSelectedEventId] = useState(replayTarget?.eventId || null)
  const [simulation, setSimulation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showEvidence, setShowEvidence] = useState(false)

  // 1. Load authoritative supported events list
  useEffect(() => {
    let active = true
    getSupportedWhatIfEvents()
      .then((list) => {
        if (!active) return
        const evs = list || []
        setSupportedEvents(evs)
        if (evs.length > 0) {
          // If navigated in with replayTarget, match it; else pick first or canonical
          const target = replayTarget?.eventId
            ? evs.find((e) => e.event_id === replayTarget.eventId)
            : null
          const initial = target || evs[0]
          if (initial) {
            setSelectedEventId(initial.event_id)
            setSelectedBay(initial.video_id)
          }
        }
      })
      .catch((err) => {
        if (!active) return
        setError(err.message || 'Failed to load supported What-If simulations.')
      })
    return () => {
      active = false
    }
  }, [replayTarget])

  // 2. Fetch the simulation whenever selectedEventId changes
  const loadSimulation = useCallback(async (eventId) => {
    if (!eventId) return
    setLoading(true)
    setError(null)
    try {
      const data = await getSafetyWhatIfSimulation(eventId)
      setSimulation(data)
    } catch (err) {
      setError(err.message || 'Failed to compute What-If simulation.')
      setSimulation(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedEventId) {
      loadSimulation(selectedEventId)
    }
  }, [selectedEventId, loadSimulation])

  // Unique bays for the camera bay filter
  const availableBays = useMemo(() => {
    const map = new Map()
    for (const ev of supportedEvents) {
      if (!map.has(ev.video_id)) {
        map.set(ev.video_id, ev.video_title || 'Optical Inspection Bay')
      }
    }
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }))
  }, [supportedEvents])

  // Filtered events based on selected camera bay
  const filteredEvents = useMemo(() => {
    if (!selectedBay) return supportedEvents
    return supportedEvents.filter((e) => e.video_id === selectedBay)
  }, [supportedEvents, selectedBay])

  // Quick switch handler
  const handleEventChange = (newId) => {
    const numId = Number(newId)
    setSelectedEventId(numId)
    const match = supportedEvents.find((e) => e.event_id === numId)
    if (match && match.video_id !== selectedBay) {
      setSelectedBay(match.video_id)
    }
  }

  const activeEvent = useMemo(
    () => supportedEvents.find((e) => e.event_id === selectedEventId) || null,
    [supportedEvents, selectedEventId],
  )

  const videoUrl = simulation?.video_id ? streamUrl(simulation.video_id) : null

  return (
    <div className="flex flex-col gap-6 pb-14 font-sans text-ink">
      {/* 5-step safety workflow banner */}
      <WorkflowNav
        currentStep={4}
        navigateTo={navigateTo}
        context={{
          eventId: selectedEventId,
          videoId: simulation?.video_id || selectedBay,
          timestamp: simulation?.timestamp,
        }}
      />

      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2 text-caption text-ink-soft">
            <button
              type="button"
              onClick={() =>
                navigateTo('Incident Replay', {
                  eventId: selectedEventId,
                  videoId: simulation?.video_id,
                  timestamp: simulation?.timestamp,
                })
              }
              className="inline-flex items-center gap-1 font-medium hover:text-ink cursor-pointer"
            >
              <ArrowLeft size={13} />
              Step 3: Forensic Replay
            </button>
            <span>/</span>
            <span className="font-semibold text-ink">Step 4: What-If Safety Simulation</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-ink uppercase">
              What-If Safety Simulation
            </h1>
            <span className="border border-ok/40 bg-ok/10 px-2 py-0.5 text-label font-bold uppercase tracking-wider text-ok">
              Pre-Action Counterfactual Test
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-small text-ink-soft">
            See how a safer action changes the observed hazard before workers intervene physically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => loadSimulation(selectedEventId)}
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 text-caption font-semibold text-ink transition-colors hover:bg-paper disabled:opacity-50 cursor-pointer"
            title="Refresh counterfactual simulation"
          >
            {loading ? (
              <span className="h-3.5 w-3.5 animate-spin border-2 border-ink border-t-transparent" />
            ) : (
              <RotateCcw size={13} />
            )}
            <span>Re-run Simulation</span>
          </button>

          <button
            type="button"
            onClick={() =>
              navigateTo('Action Center', {
                eventId: selectedEventId,
                videoId: simulation?.video_id,
                timestamp: simulation?.timestamp,
              })
            }
            className="inline-flex items-center gap-1.5 border border-ok bg-ok px-4 py-2 text-small font-bold text-paper shadow-sm transition-opacity hover:opacity-90 cursor-pointer"
          >
            <span>Step 5: Safe Action Plan</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </section>

      {/* Authoritative Dropdown Selector Bar */}
      <section className="flex flex-wrap items-center justify-between gap-3 border border-line bg-surface p-3 text-caption shadow-xs">
        <div className="flex flex-wrap items-center gap-4">
          {/* Camera Bay Selector */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink-soft">Camera Bay:</span>
            <select
              value={selectedBay}
              onChange={(e) => {
                const b = e.target.value
                setSelectedBay(b)
                const firstInBay = supportedEvents.find((x) => x.video_id === b)
                if (firstInBay) {
                  setSelectedEventId(firstInBay.event_id)
                }
              }}
              className="border border-line bg-paper px-2.5 py-1 text-small font-medium text-ink focus:border-ink cursor-pointer rounded-xs"
            >
              <option value="">All Monitored Bays ({availableBays.length})</option>
              {availableBays.map((bay) => (
                <option key={bay.id} value={bay.id}>
                  {bay.title}
                </option>
              ))}
            </select>
          </div>

          {/* Valid Supported Hazard Selector */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink-soft">Hazard Incident:</span>
            <select
              value={selectedEventId || ''}
              onChange={(e) => handleEventChange(e.target.value)}
              className="border border-line bg-paper px-2.5 py-1 text-small font-medium text-ink focus:border-ink cursor-pointer rounded-xs max-w-md truncate"
            >
              {filteredEvents.map((ev) => (
                <option key={ev.event_id} value={ev.event_id}>
                  {ev.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status Indicator */}
        {simulation && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-caption font-mono text-ink-soft">
              <span>Timestamp:</span>
              <span className="font-bold text-ink">t = {simulation.timestamp?.toFixed(1)}s</span>
            </div>
            <span className={`px-2 py-0.5 text-label font-bold uppercase rounded-xs ${BAND_BADGES[simulation.band] || 'bg-line text-ink'}`}>
              {simulation.band} Risk
            </span>
          </div>
        )}
      </section>

      {/* Error state */}
      {error && (
        <div className="border border-danger/40 bg-danger/10 p-4 text-small text-danger">
          <span className="font-bold">Error:</span> {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !simulation && (
        <div className="flex items-center justify-center gap-3 border border-line bg-surface p-12 text-small font-medium text-ink">
          <span className="h-5 w-5 animate-spin border-2 border-ink border-t-transparent rounded-full" />
          <span>Generating evidence-anchored safety simulation…</span>
        </div>
      )}

      {/* Main What-If Visual Counterfactual Flow */}
      {simulation && (
        <div className="flex flex-col gap-6">
          {/* Core Question Callout */}
          <div className="border border-line bg-paper p-3 text-center">
            <p className="text-small font-medium text-ink">
              <span className="text-signal font-bold uppercase tracking-wider text-caption mr-2">Core Question:</span>
              “If we changed this unsafe action, what would likely happen instead?”
            </p>
          </div>

          {/* 3-Step Main Presentation Card */}
          <div className="grid grid-cols-1 divide-y divide-line border border-line bg-surface shadow-xs lg:grid-cols-2 lg:divide-y-0 lg:divide-x">
            {/* STEP 1: WHAT HAPPENED */}
            <div className="flex flex-col justify-between p-6 bg-danger/5">
              <div>
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-danger px-2 py-0.5 text-label font-bold uppercase tracking-wider text-paper">
                      1. What Happened
                    </span>
                    <span className="text-caption font-semibold text-danger">Observed Action</span>
                  </div>
                  <span className="font-mono text-caption text-ink-soft">
                    Recorded t = {simulation.timestamp?.toFixed(1)}s
                  </span>
                </div>

                <div className="mt-4">
                  <h2 className="text-base font-bold text-ink">
                    {simulation.observed?.headline}
                  </h2>
                  <p className="mt-2 text-small text-ink-soft leading-relaxed">
                    {simulation.observed?.description}
                  </p>
                </div>

                {/* Scenario-Specific Visual: BEFORE */}
                <div className="mt-5">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-faint mb-2">
                    Observed Unsafe State
                  </span>
                  <WhatIfScenarioVisualizer
                    visualType={simulation.observed?.visual_type}
                    mode="before"
                    data={simulation.observed?.visual_data}
                  />
                </div>
              </div>

              {/* Observed Risk Summary */}
              <div className="mt-5 rounded border border-danger/30 bg-danger/10 p-3">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-danger">
                  Observed Hazard Exposure
                </span>
                <p className="mt-1 text-small text-ink">
                  {simulation.observed?.risk_summary}
                </p>
              </div>
            </div>

            {/* STEP 2: WHAT-IF (Safer State) */}
            <div className="flex flex-col justify-between p-6 bg-ok/5">
              <div>
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-ok px-2 py-0.5 text-label font-bold uppercase tracking-wider text-paper">
                      2. What-If
                    </span>
                    <span className="text-caption font-semibold text-ok">Safer Alternative Action</span>
                  </div>
                  <span className="rounded border border-ok/40 bg-ok/10 px-2 py-0.5 font-mono text-label font-bold text-ok">
                    Verified Safer State
                  </span>
                </div>

                <div className="mt-4">
                  <h2 className="text-base font-bold text-ink">
                    {simulation.counterfactual?.headline}
                  </h2>
                  <p className="mt-2 text-small text-ink-soft leading-relaxed">
                    {simulation.counterfactual?.action}
                  </p>
                </div>

                {/* Scenario-Specific Visual: AFTER */}
                <div className="mt-5">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-faint mb-2">
                    Simulated Safer Configuration
                  </span>
                  <WhatIfScenarioVisualizer
                    visualType={simulation.counterfactual?.visual_type}
                    mode="after"
                    data={simulation.counterfactual?.visual_data}
                  />
                </div>
              </div>

              {/* Counterfactual Expected Change */}
              <div className="mt-5 rounded border border-ok/30 bg-ok/10 p-3">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-ok">
                  Expected Impact
                </span>
                <p className="mt-1 text-small text-ink">
                  {simulation.counterfactual?.expected_outcome}
                </p>
              </div>
            </div>
          </div>

          {/* STEP 3: EXPECTED RESULT BANNER */}
          <div className="flex flex-wrap items-center justify-between gap-4 border border-line bg-paper p-5 shadow-xs">
            <div className="flex items-start gap-3 max-w-3xl">
              <div className="mt-0.5 rounded-full bg-ok/10 p-1.5 text-ok">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-caption font-bold uppercase tracking-wider text-ok">
                    3. Expected Result
                  </span>
                  <span className="border border-line bg-surface px-2 py-0.5 font-mono text-label font-bold text-ink">
                    {simulation.result?.risk_transition}
                  </span>
                </div>
                <h3 className="mt-1 text-base font-bold text-ink">
                  {simulation.result?.headline}
                </h3>
                <p className="mt-1 text-small text-ink-soft leading-relaxed">
                  {simulation.result?.explanation}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                navigateTo('Action Center', {
                  eventId: selectedEventId,
                  videoId: simulation?.video_id,
                  timestamp: simulation?.timestamp,
                })
              }
              className="inline-flex items-center gap-2 border border-ok bg-ok px-5 py-2.5 text-small font-bold text-paper shadow-xs transition-opacity hover:opacity-90 cursor-pointer shrink-0"
            >
              <span>Step 5: View Safe Action Plan &amp; Checklist</span>
              <ArrowRight size={15} />
            </button>
          </div>

          {/* Video Evidence Reference Card */}
          {videoUrl && (
            <div className="border border-line bg-surface p-4">
              <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
                <span className="text-caption font-bold uppercase tracking-wider text-ink-soft">
                  Optical Incident Evidence ({simulation.video_title})
                </span>
                <span className="font-mono text-caption text-ink-faint">
                  t = {simulation.timestamp?.toFixed(1)}s
                </span>
              </div>
              <div className="relative aspect-video max-h-72 w-full overflow-hidden rounded bg-ink flex items-center justify-center">
                <video
                  src={`${videoUrl}#t=${simulation.timestamp || 0}`}
                  controls
                  className="h-full w-full object-contain"
                />
              </div>
            </div>
          )}

          {/* Optional Progressive Disclosure: Why TRACE Recommends This */}
          <div className="border border-line bg-surface">
            <button
              type="button"
              onClick={() => setShowEvidence((v) => !v)}
              className="flex w-full items-center justify-between bg-paper px-4 py-3 text-small font-semibold text-ink-soft hover:text-ink cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Info size={15} className="text-ink-soft" />
                <span>Why TRACE recommends this (Auditable Evidence Basis)</span>
              </div>
              <div className="flex items-center gap-1 font-mono text-caption text-ink-faint">
                <span>{showEvidence ? '▲ collapse' : '▼ expand'}</span>
              </div>
            </button>

            {showEvidence && (
              <div className="flex flex-col gap-4 border-t border-line p-5 text-small text-ink-soft leading-relaxed">
                <div>
                  <span className="block font-bold text-ink">Operational Rule &amp; Standards Basis:</span>
                  <p className="mt-1">{simulation.evidence?.why_trace_recommends}</p>
                </div>

                {simulation.evidence?.signals?.length > 0 && (
                  <div>
                    <span className="block font-bold text-ink">Observed Perception Signals:</span>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-caption">
                      {simulation.evidence.signals.map((sig, idx) => (
                        <li key={idx} className="font-mono">{sig}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="border border-line bg-paper p-3 text-caption">
                    <span className="font-bold text-ink">Epistemic Status:</span>
                    <p className="mt-0.5 text-ink-soft">{simulation.evidence?.epistemic_level}</p>
                  </div>
                  <div className="border border-line bg-paper p-3 text-caption">
                    <span className="font-bold text-ink">Catalog Reference:</span>
                    <p className="mt-0.5 text-ink-soft font-mono">{simulation.evidence?.rule_reference}</p>
                  </div>
                </div>

                <div className="border-l-2 border-line-strong bg-paper/50 p-3 text-[11px] text-ink-faint italic">
                  Decision-support notice: TRACE counterfactuals are evidence-grounded transformations of observed warehouse events.
                  Supervisor verification is recommended prior to physical execution.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
