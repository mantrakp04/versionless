import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

import { localPorts } from "@versionless/env/local";

export default defineConfig({
  // Expose PORT_PREFIX to the bundle alongside VITE_*, so @versionless/env/web
  // resolves the same sibling-app ports this dev server binds.
  envPrefix: ["VITE_", "PORT_PREFIX"],
  // The dashboard is mounted at /dashboard behind the Vercel service router;
  // keep dev and prod URL spaces identical so absolute links never fork.
  base: "/dashboard/",
  build: {
    // Vercel Services preserve the public request path. Mirror the mount in
    // the artifact tree so /dashboard/assets/* resolves before the SPA fallback.
    outDir: "dist/dashboard",
    modulePreload: false,
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        "chat-sandbox": fileURLToPath(
          new URL("./chat-sandbox.html", import.meta.url),
        ),
      },
    },
  },
  server: {
    // Sandboxed documents have an opaque `null` origin. Their locally built
    // module graph is public static code, so allow that graph to load without
    // granting the iframe same-origin access to the app.
    cors: true,
    port: localPorts.dashboard,
  },
  preview: {
    cors: true,
  },
  resolve: {
    alias: {
      // The package's browser export creates a DOM element at module load.
      // Resolve it under Node's conditions instead, so the isolated compiler
      // bundle gets the data-map implementation with no module-load DOM side
      // effects — and without hardcoding an install layout.
      "decode-named-character-reference": fileURLToPath(
        import.meta.resolve("decode-named-character-reference"),
      ),
    },
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
