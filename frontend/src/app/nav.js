import {
  LayoutGrid,
  MessagesSquare,
  TriangleAlert,
  Video,
} from 'lucide-react'

// The five task areas (docs/FRONTEND_REDESIGN.md §3). Settings is rendered
// on its own below the divider.
export const PRIMARY_NAV = [
  { label: 'Monitor', path: '/monitor', icon: Video },
  { label: 'Incidents', path: '/incidents', icon: TriangleAlert },
  { label: 'Patterns', path: '/patterns', icon: LayoutGrid },
  { label: 'Assistant', path: '/assistant', icon: MessagesSquare },
]

// Operator view mode sees only the shop-floor areas (§22 / roles.js).
export const OPERATOR_PATHS = ['/monitor', '/incidents']
