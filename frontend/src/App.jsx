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
import { InterventionProvider, useIntervention } from './context/InterventionContext.jsx'
import InterventionBanner from './components/intervention/InterventionBanner.jsx'
import InterventionModal from './components/intervention/InterventionModal.jsx'

const SCREENS = [
  'Dashboard',
  'Scenario Coverage',
  'Incidents',
  'Incident Replay',
  'Action Center',
  'What-If Simulation',
  'Live View',
  'Assistant',
]

const SECONDARY_SCREENS = ['Settings']

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
  const { activeScreen, navigateTo } = useLiveViewContext()
  const { selectedAlert, setSelectedAlert } = useIntervention()

  return (
    <div className="min-h-screen bg-paper text-ink selection:bg-signal selection:text-ink">
      <Header backendStatus={backendStatus} />
      <div className="mx-auto flex max-w-[1240px]">
        <NavRail
          screens={SCREENS}
          secondaryScreens={SECONDARY_SCREENS}
          active={activeScreen}
          onSelect={navigateTo}
        />
        <main className="min-w-0 flex-1 border-l border-line px-8 py-7">
          <InterventionBanner onOpenDetail={setSelectedAlert} />

          {activeScreen === 'Dashboard' ? (
            <Dashboard />
          ) : activeScreen === 'Scenario Coverage' || activeScreen === 'Operational Intelligence' ? (
            <ScenarioCoverage />
          ) : activeScreen === 'Incidents' || activeScreen === 'Event Feed' ? (
            <EventFeed />
          ) : activeScreen === 'Incident Replay' ? (
            <IncidentReplay />
          ) : activeScreen === 'Action Center' || activeScreen === 'Safe Action Planner' ? (
            <PlannerView />
          ) : activeScreen === 'What-If Simulation' || activeScreen === 'What-If Replay' || activeScreen === 'What-If' ? (
            <WhatIfReplay />
          ) : activeScreen === 'Live View' ? (
            <LiveView />
          ) : activeScreen === 'Assistant' || activeScreen === 'AI Assistant' ? (
            <AiAssistant />
          ) : activeScreen === 'Settings' ? (
            <SupervisorSettings />
          ) : (
            <PlaceholderScreen name={activeScreen} />
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

