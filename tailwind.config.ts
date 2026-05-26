import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Roboto", "Noto Sans CJK SC", "Arial", "sans-serif"]
      },
      colors: {
        ink: "#2F3337",
        panel: "#F6F6F6",
        line: "#E1E3E6",
        cobalt: "#6B7280",
        mint: "#737A82",
        amber: "#B7791F",
        coral: "#D95C4A"
      }
    }
  },
  plugins: []
};

export default config;
