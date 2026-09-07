/**
 * LiveViewContext — shared state bridge between LiveView and PlannerView.
 *
 * LiveView writes the currently-selected video and the latest findings into
 * this context. PlannerView reads from it so it can display the actual
 * detected risk + planner recommendation instead of a static lookup table.
 *
 * This is intentionally minimal: only the three pieces of state that
 * PlannerView needs are stored here. All heavy perception/scene logic
 * remains inside LiveView.
 */
import { createContext, useContext, useState } from 'react'

const LiveViewContext = createContext(null)

export function LiveViewProvider({ children }) {
  const [liveState, setLiveState] = useState({
    selectedId: null,
    selectedFilename: null,
    currentTime: 0,
    findings: null,   // null = not loaded; [] = loaded but empty
    findingsLoading: false,
    findingsError: null,
    modelName: 'pilot',
  })

  const [activeScreen, setActiveScreen] = useState('Dashboard')
  const [replayTarget, setReplayTarget] = useState(null)

  const SCREEN_ALIASES = {
    'Safe Action Planner': 'Action Center',
    'Event Feed': 'Incidents',
    'What-If Replay': 'What-If Simulation',
    'What-If': 'What-If Simulation',
  }

  const navigateTo = (screen, target = null) => {
    if (target !== undefined && target !== null) {
      setReplayTarget(target)
    }
    const normalized = SCREEN_ALIASES[screen] || screen
    setActiveScreen(normalized)
  }

  return (
    <LiveViewContext.Provider
      value={{
        liveState,
        setLiveState,
        activeScreen,
        setActiveScreen,
        replayTarget,
        setReplayTarget,
        navigateTo,
      }}
    >
      {children}
    </LiveViewContext.Provider>
  )
}

export function useLiveViewContext() {
  const ctx = useContext(LiveViewContext)
  if (!ctx) throw new Error('useLiveViewContext must be used inside LiveViewProvider')
  return ctx
}
