import { Video, TriangleAlert, Rewind, GitCompareArrows, Zap, ChevronRight } from 'lucide-react'

const STEPS = [
  {
    step: 1,
    screen: 'Live View',
    label: '1. Live Feeds',
    shortDesc: 'Live camera monitoring',
    icon: Video,
  },
  {
    step: 2,
    screen: 'Incidents',
    label: '2. Active Hazards',
    shortDesc: 'Hazard inbox & triage',
    icon: TriangleAlert,
  },
  {
    step: 3,
    screen: 'Incident Replay',
    label: '3. Incident Replay',
    shortDesc: 'Forensic optical review',
    icon: Rewind,
  },
  {
    step: 4,
    screen: 'What-If Simulation',
    label: '4. What-If Simulator',
    shortDesc: 'Test alternative placements',
    icon: GitCompareArrows,
  },
  {
    step: 5,
    screen: 'Action Center',
    label: '5. Safe Action Plan',
    shortDesc: 'Operator action checklist',
    icon: Zap,
  },
]

export default function WorkflowNav({ currentStep = 1, navigateTo, context = {} }) {
  if (!navigateTo) return null

  const nextStep = STEPS.find((s) => s.step === currentStep + 1)
  const prevStep = STEPS.find((s) => s.step === currentStep - 1)

  return (
    <nav aria-label="Safety Investigation Workflow" className="flex flex-col gap-2 border border-line bg-surface p-3 text-small">
      {/* 5-step progress track */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wider text-ink-faint">
          <span>Safety Workflow:</span>
        </div>

        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
          {STEPS.map((s, idx) => {
            const isActive = s.step === currentStep
            const isCompleted = s.step < currentStep
            const Icon = s.icon

            return (
              <div key={s.step} className="flex items-center gap-1 sm:gap-2">
                <button
                  type="button"
                  onClick={() => navigateTo(s.screen, context)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-caption font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-ink text-paper font-semibold shadow-sm'
                      : isCompleted
                      ? 'border border-line bg-paper text-ink hover:border-line-strong'
                      : 'border border-transparent text-ink-soft hover:border-line hover:text-ink'
                  }`}
                  title={`${s.label}: ${s.shortDesc}`}
                >
                  <Icon size={12} className={isActive ? 'text-signal' : isCompleted ? 'text-ok' : 'text-ink-faint'} />
                  <span>{s.label}</span>
                </button>
                {idx < STEPS.length - 1 && (
                  <ChevronRight size={12} className="text-ink-faint shrink-0" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Guidance bar for operators/judges */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-caption">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink">
            Step {currentStep} of 5:
          </span>
          <span className="text-ink-soft">
            {currentStep === 1 && 'Observe live video feeds. When a hazard occurs, proceed to Active Hazards or Replay.'}
            {currentStep === 2 && 'Review detected safety conditions and select an incident to inspect evidence.'}
            {currentStep === 3 && 'Inspect video evidence at the moment of risk, evaluate telemetry, and verify resolution.'}
            {currentStep === 4 && 'Simulate alternative cargo placements to verify stability before floor execution.'}
            {currentStep === 5 && 'Execute certified, step-by-step corrective procedure to resolve warehouse hazard.'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {prevStep && (
            <button
              type="button"
              onClick={() => navigateTo(prevStep.screen, context)}
              className="inline-flex items-center gap-1 text-ink-soft hover:text-ink font-medium cursor-pointer"
            >
              ← {prevStep.label}
            </button>
          )}
          {prevStep && nextStep && <span className="text-ink-faint">·</span>}
          {nextStep && (
            <button
              type="button"
              onClick={() => navigateTo(nextStep.screen, context)}
              className="inline-flex items-center gap-1 text-ok hover:underline font-semibold cursor-pointer"
            >
              Next: {nextStep.label} →
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}
