import {
  LayoutGrid,
  MessagesSquare,
  ShieldCheck,
  TriangleAlert,
  Video,
  Zap,
} from 'lucide-react'

// The five task areas (docs/FRONTEND_REDESIGN.md §3). Settings is rendered
// on its own below the divider.
export const PRIMARY_NAV = [
  { label: 'Monitor', path: '/monitor', icon: Video },
  { label: 'Incidents', path: '/incidents', icon: TriangleAlert },
  { label: 'Patterns', path: '/patterns', icon: LayoutGrid },
  { label: 'Assistant', path: '/assistant', icon: MessagesSquare },
]

// Screens that still live on their own route until phase 2/3 folds them into
// Incidents / Patterns / Settings. This whole group is deleted then.
export const MIGRATING_NAV = [
  { label: 'Safe Action', path: '/planner', icon: Zap },
  { label: 'Responsible AI', path: '/responsible-ai', icon: ShieldCheck },
]

// Operator view mode sees only the shop-floor areas (§22 / roles.js).
export const OPERATOR_PATHS = ['/monitor', '/incidents']
