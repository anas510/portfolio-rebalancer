import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ledger palette. Names kept under `psx.*` so existing utility usages
        // (text-psx-navy, bg-psx-navy, hover:bg-psx-blue, text-psx-accent…)
        // remap cleanly onto the new identity.
        psx: {
          navy: "#16241B", // ink (headings, primary button)
          blue: "#1E7D46", // green (primary hover, links)
          accent: "#9C7A2C", // brass (eyebrows, folio markers)
          green: "#1E7D46",
          red: "#B23A2E",
          paper: "#F2F5EC",
          surface: "#FCFDFA",
          rule: "#D3DBCB",
          stripe: "#E9EFE0",
        },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ['"Plus Jakarta Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
