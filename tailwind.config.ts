import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  // Pirate theme classes live in @layer components (client/src/styles/pirate.css). Some are built
  // from props (e.g. ptw-btn--${variant}), so keep every ptw-* class out of the purge.
  safelist: [{ pattern: /^ptw-/ }],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Pirate theme (client/src/styles/pirate.css): font-display / font-label / font-body,
      // and ptw-* colours with alpha support, e.g. `text-ptw-ink`, `bg-ptw-wood/80`.
      fontFamily: {
        display: ["var(--ptw-font-display)"],
        label: ["var(--ptw-font-label)"],
        body: ["var(--ptw-font-body)"],
      },
      colors: {
        ptw: {
          ink: "rgb(var(--ptw-ink-rgb) / <alpha-value>)",
          "ink-soft": "rgb(var(--ptw-ink-soft-rgb) / <alpha-value>)",
          parchment: "rgb(var(--ptw-parchment-rgb) / <alpha-value>)",
          "parchment-hi": "rgb(var(--ptw-parchment-hi-rgb) / <alpha-value>)",
          burn: "rgb(var(--ptw-burn-rgb) / <alpha-value>)",
          wood: "rgb(var(--ptw-wood-rgb) / <alpha-value>)",
          "wood-dark": "rgb(var(--ptw-wood-dark-rgb) / <alpha-value>)",
          brass: "rgb(var(--ptw-brass-rgb) / <alpha-value>)",
          "brass-hi": "rgb(var(--ptw-brass-hi-rgb) / <alpha-value>)",
          wax: "rgb(var(--ptw-wax-rgb) / <alpha-value>)",
          sea: "rgb(var(--ptw-sea-rgb) / <alpha-value>)",
          cream: "rgb(var(--ptw-cream-rgb) / <alpha-value>)",
          gold: "rgb(var(--ptw-gold-rgb) / <alpha-value>)",
          good: "rgb(var(--ptw-good-rgb) / <alpha-value>)",
          bad: "rgb(var(--ptw-bad-rgb) / <alpha-value>)",
          "good-ink": "rgb(var(--ptw-good-ink-rgb) / <alpha-value>)",
          "bad-ink": "rgb(var(--ptw-bad-ink-rgb) / <alpha-value>)",
        },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
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
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
