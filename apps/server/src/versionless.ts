/**
 * The CLI's surface entry — side-effect-free (no listen; the CLI sets
 * VERSIONLESS=1 before importing). `versionless snapshot` / `check` extract
 * the cloud server's own API surface: the Elysia service routes (query plane,
 * ingest auth) and the dashboard tRPC router. The versioned DEMO surface
 * lives in apps/demo — this instance guards the cloud service's contract.
 */
import { defineSurface } from "@versionless/cli/surface/define";
import { appRouter } from "@versionless/api/routers/index";
import { v } from "@versionless/api/versionless";
import { app } from "./app";

/** The registered change chain — the CLI reads coverage from this instance. */
export const versionless = v;

export default defineSurface({
  elysia: [app],
  trpc: [{ router: appRouter, mount: "/trpc" }],
});
