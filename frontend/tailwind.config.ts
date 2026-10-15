import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#251917",
        lotus: "#8b1e1e",
        oxblood: "#4d100f",
        jade: "#225d55",
        bronze: "#7b5a43",
        antique: "#c6a664",
        parchment: "#f6efe7",
        mist: "#fcfaf7",
        sand: "#e6d7c5",
        silk: "#f8fafc",
        forest: "#203e39",
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "Manrope", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-cormorant)", "Cormorant Garamond", "Georgia", "serif"],
      },
      boxShadow: {
        "xs": "0 1px 2px rgba(77, 16, 15, 0.04)",
        "sm": "0 2px 8px rgba(77, 16, 15, 0.05)",
        "md": "0 4px 24px rgba(77, 16, 15, 0.06)",
        "lg": "0 8px 32px rgba(77, 16, 15, 0.10)",
        "xl": "0 20px 60px rgba(77, 16, 15, 0.14)",
        "glow": "0 20px 60px rgba(77, 16, 15, 0.14)",
      },
      borderRadius: {
        sm: "2px",
        md: "6px",
        lg: "12px",
        xl: "16px",
        "2xl": "24px",
        "3xl": "32px",
        full: "9999px",
      },
    },
  },
  plugins: [],
};

export default config;
