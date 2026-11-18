import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The repo root still contains the previous implementation (backend/, frontend/, venv/).
// Keep Vite and vitest away from it.
const legacy = ["**/backend/**", "**/frontend/**", "**/venv/**"];

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ["index.html"] },
  server: { watch: { ignored: legacy } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
