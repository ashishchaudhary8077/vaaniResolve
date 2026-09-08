/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          500: '#2563ff',
          600: '#1d4ed8',
          700: '#1e40af',
        },
        ink: { 900: '#0b1220', 800: '#121a2b', 700: '#1b2740' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Sora', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(37,99,255,0.55)' },
          '50%': { boxShadow: '0 0 0 18px rgba(37,99,255,0)' },
        },
        slideUp: {
          from: { transform: 'translateY(12px)', opacity: 0 },
          to: { transform: 'translateY(0)', opacity: 1 },
        },
      },
      animation: {
        pulseGlow: 'pulseGlow 1.8s ease-in-out infinite',
        slideUp: 'slideUp 0.35s ease-out both',
      },
    },
  },
  plugins: [],
};