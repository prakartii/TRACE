import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LiveViewProvider } from './LiveViewContext.jsx'
import { InterventionProvider } from './context/InterventionContext.jsx'
import AppShell from './app/AppShell.jsx'

// Screens. Primary routes still point at the pre-redesign screens; phase-1
// steps 3–5 replace Monitor / Incidents / Incident detail, phase 2–3 the rest.
import Monitor from './screens/Monitor.jsx'
import Incidents from './screens/Incidents.jsx'
import IncidentDetail from './screens/IncidentDetail.jsx'
import Patterns from './screens/Patterns.jsx'
import Assistant from './screens/Assistant.jsx'
import SupervisorSettings from './screens/SupervisorSettings.jsx'
import ResponsibleAI from './screens/ResponsibleAI.jsx'
import PlannerView from './screens/PlannerView.jsx'


export default function App() {
  return (
    <BrowserRouter>
      <LiveViewProvider>
        <InterventionProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/monitor" replace />} />
              <Route path="monitor" element={<Monitor />} />
              <Route path="incidents" element={<Incidents />} />
              <Route path="incidents/:id" element={<IncidentDetail />} />
              <Route path="incidents/:id/replay" element={<IncidentDetail />} />
              <Route path="incidents/:id/what-if" element={<IncidentDetail />} />
              <Route path="patterns" element={<Patterns />} />
              <Route path="assistant" element={<Assistant />} />
              <Route path="settings" element={<SupervisorSettings />} />

              {/* migrating — folded into Incidents / Patterns / Settings in phase 2–3 */}
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
