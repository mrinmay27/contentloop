import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { readFileSync } from "node:fs";

// The sidebar hardcoded v1.0.0 while package.json said 0.3.0 and the newest
// tag was v0.3.0 — a version users read off the screen and quote in bug
// reports. Injected from package.json so it cannot drift again.
const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api":     "http://localhost:4000",
      "/auth":    "http://localhost:4000",
      "/queues":  "http://localhost:4000",
      "/uploads": "http://localhost:4000"
    }
  },
  build: {
    outDir: "dist-web"
  }
});
