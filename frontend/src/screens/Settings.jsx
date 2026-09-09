import { Link, Navigate, useParams } from 'react-router-dom'
import SettingsRules from './SettingsRules.jsx'
import SettingsGovernance from './SettingsGovernance.jsx'
import SettingsCatalogue from './SettingsCatalogue.jsx'

const SECTIONS = [
  ['rules', 'Rules', SettingsRules],
  ['governance', 'Governance', SettingsGovernance],
  ['catalogue', 'Catalogue', SettingsCatalogue],
]

export default function Settings() {
  const { section } = useParams()
  const match = SECTIONS.find(([key]) => key === section)
  if (!match) return <Navigate to="/settings/rules" replace />
  const Body = match[2]

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-page font-semibold">Settings</h1>

      <div className="flex gap-1 border-b border-line">
        {SECTIONS.map(([key, label]) => (
          <Link
            key={key}
            to={`/settings/${key}`}
            className={`border-b-2 px-3 py-2 text-caption transition-colors ${
              key === section
                ? 'border-ink font-semibold text-ink'
                : 'border-transparent text-mute hover:text-dim'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <Body />
    </div>
  )
}
