/**
 * LiveViewContext — shared state bridge + navigation shim.
 *
 * Two jobs:
 *  1. `liveState` — the selected video + latest findings, shared between the
 *     Monitor screen and the Safe Action panel.
 *  2. A `navigateTo(screenName, target)` shim so screens written against the
 *     old string-keyed navigation keep working while the app moves to real
 *     routes. It maps the old names to paths and pushes the router, carrying
 *     `target` as `replayTarget` (both in React state and in history state so
 *     a back-nav restores it).
 *
 * New screens should use react-router (`useNavigate`, `<Link>`, `useParams`)
 * directly. This shim is removed once no screen depends on it.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const LiveViewContext = createContext(null)

// Old screen name -> path. An `eventId` on the target routes to that incident.
function screenToPath(screen, target) {
  switch (screen) {
    case 'Live View':
    case 'Monitor':
      return '/monitor'
    case 'Incidents':
    case 'Event Feed':
      return '/incidents'
    case 'Incident Replay':
      return target?.eventId ? `/incidents/${target.eventId}` : '/incidents'
    case 'Dashboard':
    case 'Patterns':
      return '/patterns'
    case 'Assistant':
    case 'AI Assistant':
      return '/assistant'
    case 'Settings':
      return '/settings'
    case 'What-If Simulation':
    case 'What-If Replay':
    case 'What-If':
      return '/incidents'
    case 'Scenario Coverage':
      return '/patterns'
    case 'Responsible AI':
      return '/responsible-ai'
    case 'Action Center':
    case 'Safe Action Planner':
      return '/planner'
    default:
      return '/monitor'
  }
}

export function LiveViewProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()

  const [liveState, setLiveState] = useState({
    selectedId: null,
    selectedFilename: null,
    currentTime: 0,
    findings: null, // null = not loaded; [] = loaded but empty
    findingsLoading: false,
    findingsError: null,
    modelName: 'pilot',
  })

  const [replayTargetState, setReplayTarget] = useState(null)

  const [role, setRoleState] = useState(() => {
    try {
      return localStorage.getItem('trace.role') || 'supervisor'
    } catch {
      return 'supervisor'
    }
  })
  const setRole = useCallback((r) => {
    setRoleState(r)
    try {
      localStorage.setItem('trace.role', r)
    } catch {
      /* ignore */
    }
  }, [])

  const navigateTo = useCallback(
    (screen, target = null) => {
      if (target !== undefined && target !== null) setReplayTarget(target)
      const path = screenToPath(screen, target)
      navigate(path, target ? { state: { replayTarget: target } } : undefined)
    },
    [navigate],
  )

  // Prefer the target carried in history state (survives back-nav / reload)
  // over the last one set imperatively.
  const replayTarget = location.state?.replayTarget ?? replayTargetState

  const value = useMemo(
    () => ({
      liveState,
      setLiveState,
      replayTarget,
      setReplayTarget,
      navigateTo,
      role,
      setRole,
    }),
    [liveState, replayTarget, navigateTo, role, setRole],
  )

  return <LiveViewContext.Provider value={value}>{children}</LiveViewContext.Provider>
}

export function useLiveViewContext() {
  const ctx = useContext(LiveViewContext)
  if (!ctx) throw new Error('useLiveViewContext must be used inside LiveViewProvider')
  return ctx
}
