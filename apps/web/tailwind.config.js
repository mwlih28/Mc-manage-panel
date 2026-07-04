/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm-neutral dark scale — replaces the old pure-gray palette so
        // surfaces read as "designed" rather than default-gray.
        zinc: {
          50:  '#EDEDEF',
          100: '#DCDDE0',
          200: '#C4C6CB',
          300: '#9A9CA3',
          400: '#7A7D85',
          500: '#616469',
          600: '#4A4D54',
          700: '#33363C',
          800: '#26282D',
          850: '#1F2125',
          900: '#1B1D21',
          925: '#161719',
          950: '#131417',
          975: '#0B0C0E',
        },
        // "panel" is this app's brand/accent color, referenced across the
        // codebase (sidebar active state, buttons, badges, progress bars).
        // It was previously an alias for plain gray — i.e. the UI had no
        // real accent color at all. Now a muted teal-green (not neon, not
        // the default Tailwind emerald every AI-generated dashboard uses).
        panel: {
          50:  '#E8FBF3',
          100: '#C7F3E1',
          200: '#9FE8CB',
          300: '#6FD9B0',
          400: '#3EC896',
          500: '#22A878',
          600: '#1C8C66',
          700: '#167056',
          800: '#115646',
          900: '#0B3D33',
          950: '#06231A',
        },
        dark: {
          50:  '#EDEDEF',
          100: '#DCDDE0',
          200: '#C4C6CB',
          300: '#9A9CA3',
          400: '#7A7D85',
          500: '#616469',
          600: '#4A4D54',
          700: '#33363C',
          800: '#26282D',
          850: '#1F2125',
          900: '#1B1D21',
          950: '#131417',
          1000: '#0B0C0E',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',   opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
