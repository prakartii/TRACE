/** @type {import('tailwindcss').Config} */

// TRACE frontend redesign — "strip to plain".
// System font, near-monochrome, one hue per risk band, thin single borders,
// whitespace. See docs/FRONTEND_REDESIGN.md §5.
//
// Legacy token names (paper, surface, ink-soft, signal, danger, …) are kept as
// aliases pointing at the new values so screens not yet rebuilt render in the
// new palette during the migration. They are removed in phase 3.

const SANS = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
]
const MONO = [
  'ui-monospace',
  '"SF Mono"',
  '"Cascadia Code"',
  'Menlo',
  'Consolas',
  'monospace',
]

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // surfaces
        bg: '#FFFFFF',
        raised: '#FAFAFA',
        // text
        ink: '#1A1A1A',
        dim: '#6B6B6B',
        mute: '#9A9A9A',
        // hairlines
        line: '#E4E4E4',
        'line-strong': '#CFCFCF',
        // semantic — these carry meaning (risk band, verified), not "accent"
        crit: '#B4231A',
        high: '#C77700',
        ok: '#2E7D46',

        // ---- legacy aliases (removed in phase 3) ----
        paper: '#FFFFFF',
        surface: '#FAFAFA',
        'ink-soft': '#6B6B6B',
        'ink-faint': '#9A9A9A',
        signal: '#C77700',
        danger: '#B4231A',
        steel: '#6B6B6B',
      },
      fontFamily: {
        sans: SANS,
        mono: MONO,
        display: SANS, // was Barlow Condensed; folded into the system stack
      },
      fontSize: {
        // the real scale — three sizes plus two utility sizes
        page: ['1.3125rem', { lineHeight: '1.15', letterSpacing: '-0.015em' }],
        section: ['0.9375rem', { lineHeight: '1.3' }],
        body: ['0.8125rem', { lineHeight: '1.55' }],
        caption: ['0.75rem', { lineHeight: '1.4' }],
        label: ['0.6875rem', { lineHeight: '1.3' }],

        // ---- legacy keys, flattened toward the new scale (removed in phase 3) ----
        'display-xl': ['1.5rem', { lineHeight: '1.1', letterSpacing: '-0.015em' }],
        'display-lg': ['1.3125rem', { lineHeight: '1.15', letterSpacing: '-0.015em' }],
        'display-md': ['1.125rem', { lineHeight: '1.25' }],
        title: ['0.9375rem', { lineHeight: '1.3' }],
        small: ['0.8125rem', { lineHeight: '1.45' }],
      },
      borderRadius: {
        md: '6px',
      },
    },
  },
  plugins: [],
}
