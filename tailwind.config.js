/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        steel: '#4682B4',
        steelDeep: '#2F5D85',
        steelIce: '#A9C6E0',
        mist: '#E8F0F7',
        graphite: 'rgba(16, 24, 32, 0.85)',
        success: '#5FB49C',
      },
    },
  },
  plugins: [],
}
