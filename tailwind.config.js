/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      boxShadow: {
        '3xl': '0 20px 64px 0 rgba(4,25,59,0.16), 0 3px 12px rgba(162,210,255,0.08)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: 0, transform: 'translateY(24px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%':   { transform: 'scale(0.85)', opacity: 0 },
          '50%':  { transform: 'scale(1.05)', opacity: 1 },
          '80%':  { transform: 'scale(0.98)', opacity: 1 },
          '100%': { transform: 'scale(1)', opacity: 1 },
        },
        'burst-confetti': {
          '0%': {
            opacity: 1,
            transform:
              'translate(-50%, -50%) translate(0px, 0px) rotate(var(--confetti-rotate-start,0deg))'
          },
          '8%': {
            opacity: 0
          },
          '60%': {
            opacity: 1
          },
          '100%': {
            opacity: 0,
            transform:
              'translate(-50%, -50%) translate(var(--confetti-x,0px), var(--confetti-y,0px)) rotate(var(--confetti-rotate-end,360deg))'
          }
        },
      },
      animation: {
        'fade-in': 'fade-in 0.7s cubic-bezier(.5,1.6,.7,1) both',
        'pop-in': 'pop-in 0.7s cubic-bezier(.36,1.46,.58,1.01) both',
        'burst-confetti': 'burst-confetti 2.2s cubic-bezier(.43,1.1,.69,.92) forwards',
      }
    },
  },
  plugins: [],
}