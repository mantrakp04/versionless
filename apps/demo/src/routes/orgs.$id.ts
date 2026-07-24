// Rewrite alias: "GET /orgs/:id" -> "GET /teams/:id" (change 2025-06-01).
// File routing means the old path needs its own route file; the alias
// forwards old-pinned clients to the target handler and 404s current ones.
import { createFileRoute } from "@tanstack/react-router";
import { versionlessAlias } from "@versionless/adapter-tanstack-start";
import { teamByIdGET } from "~/server/handlers";
import { v } from "~/versions";

export const Route = createFileRoute("/orgs/$id")({
  server: {
    handlers: { GET: versionlessAlias(v, teamByIdGET, { route: "/orgs/$id" }) },
  },
});
