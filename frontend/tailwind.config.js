/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#EBE6D9',
        surface: '#F6F2E9',
        ink: '#1A1712',
        'ink-soft': '#5B5342',
        'ink-faint': '#948A75',
        line: '#D7CFBD',
        'line-strong': '#A99D84',
        signal: '#C28208',
        danger: '#B23A22',
        ok: '#3F6E4C',
        steel: '#4E626C',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-xl': ['2.5rem', { lineHeight: '0.95', letterSpacing: '-0.01em' }],
        'display-lg': ['1.875rem', { lineHeight: '1', letterSpacing: '-0.01em' }],
        'display-md': ['1.5rem', { lineHeight: '1.05', letterSpacing: '-0.005em' }],
        title: ['1.125rem', { lineHeight: '1.3' }],
        body: ['0.9375rem', { lineHeight: '1.55' }],
        small: ['0.8125rem', { lineHeight: '1.45' }],
        caption: ['0.75rem', { lineHeight: '1.4' }],
        label: ['0.6875rem', { lineHeight: '1.3' }],
      },
    },
  },
  plugins: [],
}
