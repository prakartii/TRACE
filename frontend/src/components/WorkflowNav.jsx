import { Video, TriangleAlert, Rewind, GitCompareArrows, Zap, ChevronRight, ArrowRight } from 'lucide-react'

const STEPS = [
  {
    step: 1,
    screen: 'Live View',
    label: '1. Live Feeds',
    shortDesc: 'What is happening right now',
    icon: Video,
  },
  {
    step: 2,
    screen: 'Incidents',
    label: '2. Active Hazards',
    shortDesc: 'What needs supervisor attention',
    icon: TriangleAlert,
  },
  {
    step: 3,
    screen: 'Incident Replay',
    label: '3. Incident Replay',
    shortDesc: 'What actually happened',
    icon: Rewind,
  },
  {
    step: 4,
    screen: 'What-If Simulation',
    label: '4. What-If Simulator',
    shortDesc: 'What if we change the placement',
    icon: GitCompareArrows,
  },
  {
    step: 5,
    screen: 'Action Center',
    label: '5. Safe Action Plan',
    shortDesc: 'What the supervisor should do now',
    icon: Zap,
  },
]

export default function WorkflowNav({ currentStep = 1, navigateTo, context = {} }) {
  if (!navigateTo) return null

  const activeStepObj = STEPS.find((s) => s.step === currentStep) || STEPS[0]
  const nextStep = STEPS.find((s) => s.step === currentStep + 1)
  const prevStep = STEPS.find((s) => s.step === currentStep - 1)

  return (
    <nav
      aria-label="Intelligence Decision Workflow"
      className="border border-line bg-surface px-4 py-3 text-small"
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* Step Track */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint mr-1">
            Workflow:
          </span>
          {STEPS.map((s, idx) => {
            const isActive = s.step === currentStep
            const isCompleted = s.step < currentStep
            const Icon = s.icon

            return (
              <div key={s.step} className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => navigateTo(s.screen, context)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-caption font-medium transition-colors cursor-pointer rounded-xs ${
                    isActive
                      ? 'bg-ink text-paper font-semibold shadow-xs'
                      : isCompleted
                      ? 'border border-line bg-paper text-ink hover:border-ink'
                      : 'border border-transparent text-ink-soft hover:text-ink'
                  }`}
                  title={`${s.label} — ${s.shortDesc}`}
                >
                  <Icon
                    size={13}
                    className={isActive ? 'text-signal' : isCompleted ? 'text-ok' : 'text-ink-faint'}
                  />
                  <span>{s.label}</span>
                </button>
                {idx < STEPS.length - 1 && (
                  <ChevronRight size={13} className="text-ink-faint shrink-0" />
                )}
              </div>
            )
          })}
        </div>

        {/* Next Step Primary Action */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {prevStep && (
            <button
              type="button"
              onClick={() => navigateTo(prevStep.screen, context)}
              className="text-caption text-ink-soft hover:text-ink transition-colors cursor-pointer px-1.5 py-0.5"
            >
              ← Back
            </button>
          )}
          {nextStep && (
            <button
              type="button"
              onClick={() => navigateTo(nextStep.screen, context)}
              className="inline-flex items-center gap-1.5 bg-ink px-3 py-1.5 text-caption font-semibold text-paper transition-colors hover:bg-ink-soft cursor-pointer shadow-xs"
            >
              <span>Next: {nextStep.label}</span>
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Purpose Banner */}
      <div className="mt-2.5 flex items-center justify-between border-t border-line/70 pt-2 text-caption text-ink-soft">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink">Stage {currentStep} Focus:</span>
          <span>{activeStepObj.shortDesc}</span>
        </div>
        <span className="hidden sm:inline font-mono text-[11px] text-ink-faint">
          TRACE Decision Loop (Step {currentStep} of 5)
        </span>
      </div>
    </nav>
  )
}
