/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        amber: { DEFAULT: '#BA7517', light: '#F5E6C8' },
        teal: { DEFAULT: '#1D9E75', light: '#D1F0E7' },
        coral: { DEFAULT: '#993C1D', light: '#F5D9D1' },
        surface: '#F5F4F0',
        border: 'rgba(0,0,0,0.1)',
        text: {
          primary: '#1A1917',
          secondary: '#6B6A65',
          tertiary: '#A09E99',
        },
      },
      fontFamily: {
        lora: ['Lora', 'Georgia', 'serif'],
        mono: ['"DM Mono"', 'monospace'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
        component: '8px',
      },
    },
  },
  plugins: [],
};
