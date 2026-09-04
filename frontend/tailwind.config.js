/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#fafaf9',
        ink: '#18181b',
        line: '#e4e4e7',
      },
    },
  },
  plugins: [],
}
