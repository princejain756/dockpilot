import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        canvas: "rgb(var(--bg-canvas-rgb) / <alpha-value>)",
        surface: "rgb(var(--bg-surface-rgb) / <alpha-value>)",
        subtle: "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
        raised: "rgb(var(--bg-raised-rgb) / <alpha-value>)",
        ink: "rgb(var(--text-ink-rgb) / <alpha-value>)",
        muted: "rgb(var(--text-muted-rgb) / <alpha-value>)",
        faint: "rgb(var(--text-faint-rgb) / <alpha-value>)",
        line: "rgb(var(--border-line-rgb) / <alpha-value>)",
        "line-strong": "rgb(var(--border-strong-rgb) / <alpha-value>)",
        field: "rgb(var(--border-field-rgb) / <alpha-value>)",
        rail: "rgb(var(--rail-bg-rgb) / <alpha-value>)",
        "rail-hover": "rgb(var(--rail-hover-rgb) / <alpha-value>)",
        accent: "rgb(var(--accent-main-rgb) / <alpha-value>)",
        "accent-ink": "rgb(var(--accent-ink-rgb) / <alpha-value>)",
        "ok-bg": "rgb(var(--ok-bg-rgb) / <alpha-value>)",
        "ok-ink": "rgb(var(--ok-ink-rgb) / <alpha-value>)",
        "warn-bg": "rgb(var(--warn-bg-rgb) / <alpha-value>)",
        "warn-ink": "rgb(var(--warn-ink-rgb) / <alpha-value>)",
        "block-bg": "rgb(var(--block-bg-rgb) / <alpha-value>)",
        "block-ink": "rgb(var(--block-ink-rgb) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};

export default config;
