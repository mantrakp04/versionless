import { env } from "@versionless/env/server";
import { app } from "./app";

export default app;

// Deploy-time migration gate (Hexclave-style RUN_MIGRATIONS): opt-in via env
// so dev keeps its `db:push` loop and serverless never migrates per-invoke.
// Runs before listen — with multiple replicas, run one migrating instance
// first (drizzle journals applied migrations, so re-runs are no-ops).
if (env.RUN_MIGRATIONS === "true" && !env.VERSIONLESS) {
  const { runMigrations } = await import("@versionless/db/migrate");
  await runMigrations(env.DATABASE_URL);
  console.log("[db] migrations applied");
}

// Elysia's default export is not auto-served by Bun or Node, so start a local
// server outside Vercel while still exporting the app for Vercel functions.
// VERSIONLESS is set by the versionless CLI when importing the app for
// surface extraction — never bind a port in that case.
if (!env.VERCEL && !env.VERSIONLESS) {
  app.listen({ hostname: "0.0.0.0", port: env.PORT }, () => {
    console.log(`Server is running on http://0.0.0.0:${env.PORT}`);
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.stop();
  };

  process.once("SIGINT", () => {
    void stop().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop().then(() => process.exit(0));
  });
}
