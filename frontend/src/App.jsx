import { useEffect, useState } from 'react'
import Header from './components/Header.jsx'
import NavRail from './components/NavRail.jsx'
import { API_BASE_URL } from './config.js'

const SCREENS = [
  'Live View',
  'Safe Action Planner',
  'Structural View',
  'Event Feed',
  'Incident Replay',
  'Dashboard',
  'Assistant',
  'What-If Replay',
  'Micro-Training',
  'Settings',
]

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

export default function App() {
  const backendStatus = useBackendStatus()
  const [activeScreen, setActiveScreen] = useState(SCREENS[0])

  return (
    <div className="min-h-screen bg-paper text-ink">
      <Header backendStatus={backendStatus} />
      <div className="mx-auto flex max-w-6xl">
        <NavRail screens={SCREENS} active={activeScreen} onSelect={setActiveScreen} />
        <main className="flex-1 border-l border-line px-8 py-6">
          <h1 className="text-lg font-medium">{activeScreen}</h1>
          <p className="mt-2 max-w-prose text-sm text-neutral-600">
            Phase 1 scaffold — this screen has no functionality yet. It will be built out
            in its corresponding development phase.
          </p>
        </main>
      </div>
    </div>
  )
}
