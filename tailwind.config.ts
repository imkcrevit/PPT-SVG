import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"]
      },
      colors: {
        bg: "#FDFDFB",
        bg2: "#F7F7F4",
        bg3: "#EFEEE9",
        ink: "#1D1D1B",
        mid: "#5F615C",
        faint: "#8B8D86",
        panel: "#FFFFFF",
        line: "rgba(29,29,27,0.10)",
        subtle: "#EEEEEA",
        accent: "#C45F3C",
        accent2: "#A94B2F",
        cobalt: "#C45F3C",
        mint: "#A94B2F",
        amber: "#B7791F",
        coral: "#C45F3C"
      }
    }
  },
  plugins: []
};

export default config;
