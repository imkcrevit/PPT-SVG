import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Roboto", "Noto Sans CJK SC", "Arial", "sans-serif"]
      },
      colors: {
        ink: "#1D2433",
        panel: "#F7F8FA",
        line: "#D9DEE8",
        cobalt: "#315CFF",
        mint: "#1F9D7A",
        amber: "#B7791F",
        coral: "#D95C4A"
      }
    }
  },
  plugins: []
};

export default config;

