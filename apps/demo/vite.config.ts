import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// The whole demo — client assets AND server routes — lives under /demo, so
// the main Vercel deployment can mount it next to /docs and /api. Nitro turns
// the SSR build into deployable output (the `vercel` preset under VERCEL).
export default defineConfig({
  base: "/demo/",
  server: {
    port: 3003,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [tanstackStart(), nitro(), react()],
});
