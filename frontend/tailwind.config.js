/** @type {import('tailwindcss').Config} */

// TRACE frontend redesign — "strip to plain".
// System font, near-monochrome, one hue per risk band, thin single borders,
// whitespace. See docs/FRONTEND_REDESIGN.md §5.
//

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
      },
      fontFamily: {
        sans: SANS,
        mono: MONO,
      },
      fontSize: {
        // the real scale — three sizes plus two utility sizes
        page: ['1.3125rem', { lineHeight: '1.15', letterSpacing: '-0.015em' }],
        section: ['0.9375rem', { lineHeight: '1.3' }],
        body: ['0.8125rem', { lineHeight: '1.55' }],
        caption: ['0.75rem', { lineHeight: '1.4' }],
        label: ['0.6875rem', { lineHeight: '1.3' }],
      },
      borderRadius: {
        md: '6px',
      },
    },
  },
  plugins: [],
}
