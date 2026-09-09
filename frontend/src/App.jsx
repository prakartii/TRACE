import { useEffect, useState } from 'react'
import Header from './components/Header.jsx'
import NavRail from './components/NavRail.jsx'
import { API_BASE_URL } from './config.js'
import { LiveViewProvider, useLiveViewContext } from './LiveViewContext.jsx'
import EventFeed from './screens/EventFeed.jsx'
import IncidentReplay from './screens/IncidentReplay.jsx'
import LiveView from './screens/LiveView.jsx'
import PlaceholderScreen from './screens/PlaceholderScreen.jsx'
import PlannerView from './screens/PlannerView.jsx'
import SupervisorSettings from './screens/SupervisorSettings.jsx'
import WhatIfReplay from './screens/WhatIfReplay.jsx'
import Dashboard from './screens/Dashboard.jsx'
import ScenarioCoverage from './screens/ScenarioCoverage.jsx'
import AiAssistant from './screens/AiAssistant.jsx'
import ResponsibleAI from './screens/ResponsibleAI.jsx'
import { OPERATOR_SCREENS } from './lib/roles.js'
import { InterventionProvider, useIntervention } from './context/InterventionContext.jsx'
import InterventionBanner from './components/intervention/InterventionBanner.jsx'
import InterventionModal from './components/intervention/InterventionModal.jsx'

const SCREENS = [
  'Live View',
  'Incidents',
  'Incident Replay',
  'Action Center',
  'What-If Simulation',
  'Dashboard',
  'Scenario Coverage',
  'Assistant',
]

const SECONDARY_SCREENS = ['Responsible AI', 'Settings']

function useBackendStatus() {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE_URL}/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(() => !cancelled && setStatus('online'))
      .catch(() => !cancelled && setStatus('offline'))
    return () => {
      cancelled = true
    }
  }, [])

  return status
}

function AppContent() {
  const backendStatus = useBackendStatus()
  const { activeScreen, navigateTo, role } = useLiveViewContext()
  const { selectedAlert, setSelectedAlert } = useIntervention()

  const isOperator = role === 'operator'
  const visibleScreens = isOperator ? SCREENS.filter((s) => OPERATOR_SCREENS.includes(s)) : SCREENS
  const visibleSecondary = isOperator ? [] : SECONDARY_SCREENS
  // If the operator view hides the active screen, fall back to Live View.
  const effectiveScreen =
    isOperator && !OPERATOR_SCREENS.includes(activeScreen) ? 'Live View' : activeScreen

  return (
    <div className="min-h-screen bg-paper text-ink selection:bg-signal selection:text-ink">
      <Header backendStatus={backendStatus} />
      <div className="mx-auto flex max-w-[1240px]">
        <NavRail
          screens={visibleScreens}
          secondaryScreens={visibleSecondary}
          active={effectiveScreen}
          onSelect={navigateTo}
        />
        <main className="min-w-0 flex-1 border-l border-line px-8 py-7">
          <InterventionBanner onOpenDetail={setSelectedAlert} />

          {effectiveScreen === 'Dashboard' ? (
            <Dashboard />
          ) : effectiveScreen === 'Scenario Coverage' || effectiveScreen === 'Operational Intelligence' ? (
            <ScenarioCoverage />
          ) : effectiveScreen === 'Incidents' || effectiveScreen === 'Event Feed' ? (
            <EventFeed />
          ) : effectiveScreen === 'Incident Replay' ? (
            <IncidentReplay />
          ) : effectiveScreen === 'Action Center' || effectiveScreen === 'Safe Action Planner' ? (
            <PlannerView />
          ) : effectiveScreen === 'What-If Simulation' || effectiveScreen === 'What-If Replay' || effectiveScreen === 'What-If' ? (
            <WhatIfReplay />
          ) : effectiveScreen === 'Live View' ? (
            <LiveView />
          ) : effectiveScreen === 'Assistant' || effectiveScreen === 'AI Assistant' ? (
            <AiAssistant />
          ) : effectiveScreen === 'Responsible AI' ? (
            <ResponsibleAI />
          ) : effectiveScreen === 'Settings' ? (
            <SupervisorSettings />
          ) : (
            <PlaceholderScreen name={effectiveScreen} />
          )}
        </main>
      </div>

      {selectedAlert && (
        <InterventionModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      )}
    </div>
  )
}

export default function App() {
  return (
    <LiveViewProvider>
      <InterventionProvider>
        <AppContent />
      </InterventionProvider>
    </LiveViewProvider>
  )
}

