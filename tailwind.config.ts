import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        muted: "#667085",
        line: "#e5e7eb",
        brand: { DEFAULT: "#007a4d", dark: "#005f3d", soft: "#e8f6ef" },
        cream: "#fbfaf7"
      },
      boxShadow: { soft: "0 10px 30px rgba(15, 23, 42, 0.06)" }
    }
  },
  plugins: []
};
export default config;
