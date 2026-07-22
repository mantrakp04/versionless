import { cors } from "@elysiajs/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "@versionless/api/context";
import { appRouter } from "@versionless/api/routers/index";
import { env } from "@versionless/env/server";
import { Elysia } from "elysia";
import { evlogPlugin } from "./logger";

const app = new Elysia()
  .use(evlogPlugin)
  .use(
    cors({
      origin: env.CORS_ORIGIN,
      methods: ["GET", "POST", "OPTIONS"],
    }),
  )
  .all("/trpc/*", async (context) => {
    const res = await fetchRequestHandler({
      endpoint: "/trpc",
      router: appRouter,
      req: context.request,
      createContext: () => createContext({ context }),
    });
    return res;
  })
  .get("/", () => "OK");

export default app;

// Elysia's default export is not auto-served by Bun or Node, so start a local
// server outside Vercel while still exporting the app for Vercel functions.
if (!process.env.VERCEL) {
  app.listen(3000, () => {
    console.log("Server is running on http://localhost:3000");
  });
}
