// @aurora/web - Tailwind Configuration
// Aurora theme: Minimalist dark mode, vibrant indigo accents

export default {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Aurora Color Palette (matches CSS custom properties)
        bgPrimary: '#0a0a0a',       /* void-like deep darkness */
        bgSecondary: '#18181b',     /* zinc-900 */
        
        textPrimary: '#fafafa',     /* zinc-100 */
        textSecondary: '#a1a1aa',   /* zinc-500 */
        
        // Accent colors
        accent: {
          DEFAULT: '#6366f1',       /* indigo-500 */
          hover: '#4f46e5',         /* indigo-600 */
          light: '#818cf8',         /* indigo-400 */
        },
        
        // Code block background
        codeBg: '#242427',
        
        // Border colors
        borderDefault: 'rgba(39, 39, 42, 0.4)',
        borderHover: 'rgba(63, 63, 70, 0.4)',
      },
      
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'JetBrains Mono', 'monospace'],
      },
      
      borderRadius: {
        // Custom border radius values for consistent design
        'xl': '0.75rem',    /* slightly more rounded than default */
      },
      
      boxShadow: {
        'soft': '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
        'subtle': '0 1px 2px rgba(0, 0, 0, 0.1)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}