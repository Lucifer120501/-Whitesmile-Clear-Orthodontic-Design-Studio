/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // WhiteSmile brand teal (synced with main system header #46c0bd)
        clinical: {
          50: '#ecfdfc',
          100: '#cff6f4',
          200: '#a5ece9',
          300: '#6fdcd9',
          400: '#46c0bd',
          500: '#38a5a2',
          600: '#2f8684',
          700: '#2a6b6a',
          800: '#265655',
          900: '#224847',
          950: '#0f2b2a',
        },
      },
    },
  },
  plugins: [],
}
