import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // FOLĒR palette (ivory / stone / ink) mapped onto the zinc scale so the
        // light pages share the Insights page's warmth.
        zinc: {
          50: "#f4f3ee",
          100: "#ebeae4",
          200: "#e0e2dc",
          300: "#cbcec7",
          400: "#979b95",
          500: "#6d716b",
          600: "#53564f",
          700: "#3e403c",
          800: "#2f312e",
          900: "#262827",
          950: "#1b1c1b",
        },
        sage: { 100: "#e9efe9", 200: "#dde5dd", 400: "#b9d6b9", 700: "#4f6b4f" },
      },
      borderRadius: { lg: "14px", md: "9px" },
      fontFamily: { sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
