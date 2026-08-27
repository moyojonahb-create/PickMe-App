import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // CruiXe custom colors
        cruixe: {
          red: "hsl(var(--cruixe-red))",
          "red-dark": "hsl(var(--cruixe-red-dark))",
          "red-light": "hsl(var(--cruixe-red-light))",
          yellow: "hsl(var(--cruixe-yellow))",
          "yellow-light": "hsl(var(--cruixe-yellow-light))",
          white: "hsl(var(--cruixe-white))",
          dark: "hsl(var(--cruixe-dark))",
          "gray-100": "hsl(var(--cruixe-gray-100))",
          "gray-200": "hsl(var(--cruixe-gray-200))",
          "gray-300": "hsl(var(--cruixe-gray-300))",
          "gray-400": "hsl(var(--cruixe-gray-400))",
          "gray-500": "hsl(var(--cruixe-gray-500))",
          "gray-600": "hsl(var(--cruixe-gray-600))",
          "gray-700": "hsl(var(--cruixe-gray-700))",
          "gray-800": "hsl(var(--cruixe-gray-800))",
          "gray-900": "hsl(var(--cruixe-gray-900))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      fontFamily: {
        sans: ['Sora', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        display: ['Space Grotesk', 'Sora', 'sans-serif'],
      },
      boxShadow: {
        'cruixe-xs': 'var(--shadow-xs)',
        'cruixe-sm': 'var(--shadow-sm)',
        'cruixe-md': 'var(--shadow-md)',
        'cruixe-lg': 'var(--shadow-lg)',
        'cruixe-xl': 'var(--shadow-xl)',
        'cruixe-card': 'var(--shadow-card)',
        'cruixe-phone': 'var(--shadow-phone)',
        'cruixe-glow': 'var(--shadow-glow)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "slide-up-fade": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-fade-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "count-up": {
          "0%": { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.8)", opacity: "0.8" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        "shimmer": {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "slide-up-fade": "slide-up-fade 0.3s ease-out",
        "scale-fade-in": "scale-fade-in 0.2s ease-out",
        "count-up": "count-up 0.3s ease-out",
        "pulse-ring": "pulse-ring 1.5s ease-out infinite",
        "float": "float 3s ease-in-out infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
