import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // The dashboard is mounted at /dashboard behind the Vercel service router;
  // keep dev and prod URL spaces identical so absolute links never fork.
  base: "/dashboard/",
  build: {
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
    port: 3001,
  },
  preview: {
    cors: true,
  },
  resolve: {
    alias: {
      // The package's browser export creates a DOM element at module load.
      // Use its data-map implementation so the isolated compiler bundle has
      // no module-load DOM side effects.
      "decode-named-character-reference": fileURLToPath(
        new URL(
          "./node_modules/decode-named-character-reference/index.js",
          import.meta.url,
        ),
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
