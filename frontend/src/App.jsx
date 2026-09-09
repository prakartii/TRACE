import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { LiveViewProvider, useLiveViewContext } from './LiveViewContext.jsx'
import { InterventionProvider } from './context/InterventionContext.jsx'
import AppShell from './app/AppShell.jsx'

// Screens. Primary routes still point at the pre-redesign screens; phase-1
// steps 3–5 replace Monitor / Incidents / Incident detail, phase 2–3 the rest.
import LiveView from './screens/LiveView.jsx'
import EventFeed from './screens/EventFeed.jsx'
import IncidentReplay from './screens/IncidentReplay.jsx'
import Dashboard from './screens/Dashboard.jsx'
import AiAssistant from './screens/AiAssistant.jsx'
import SupervisorSettings from './screens/SupervisorSettings.jsx'
import WhatIfReplay from './screens/WhatIfReplay.jsx'
import ScenarioCoverage from './screens/ScenarioCoverage.jsx'
import ResponsibleAI from './screens/ResponsibleAI.jsx'
import PlannerView from './screens/PlannerView.jsx'

// Feeds the `:id` from the URL into the old string-nav `replayTarget` so a
// direct load / refresh of /incidents/:id still selects that incident. Removed
// when step 5 rebuilds this screen against `useParams` directly.
function IncidentDetailRoute() {
  const { id } = useParams()
  const { replayTarget, setReplayTarget } = useLiveViewContext()
  useEffect(() => {
    const eid = Number(id)
    if (eid && replayTarget?.eventId !== eid) {
      setReplayTarget({ ...(replayTarget || {}), eventId: eid })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return <IncidentReplay />
}

export default function App() {
  return (
    <BrowserRouter>
      <LiveViewProvider>
        <InterventionProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/monitor" replace />} />
              <Route path="monitor" element={<LiveView />} />
              <Route path="incidents" element={<EventFeed />} />
              <Route path="incidents/:id" element={<IncidentDetailRoute />} />
              <Route path="patterns" element={<Dashboard />} />
              <Route path="assistant" element={<AiAssistant />} />
              <Route path="settings" element={<SupervisorSettings />} />

              {/* migrating — folded into Incidents / Patterns / Settings in phase 2–3 */}
              <Route path="what-if" element={<WhatIfReplay />} />
              <Route path="coverage" element={<ScenarioCoverage />} />
              <Route path="responsible-ai" element={<ResponsibleAI />} />
              <Route path="planner" element={<PlannerView />} />

              <Route path="*" element={<Navigate to="/monitor" replace />} />
            </Route>
          </Routes>
        </InterventionProvider>
      </LiveViewProvider>
    </BrowserRouter>
  )
}
