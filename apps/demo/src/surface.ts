/**
 * The CLI's surface entry — side-effect-free (no server start; the CLI sets
 * VERSIONLESS=1 before importing). `versionless snapshot` / `check` extract
 * the API surface from the oRPC router plus manual declarations for the
 * TanStack Start server routes (file-route handlers carry no schemas, so the
 * manual list IS the wire declaration), with named models coming from the
 * same drizzle-zod schemas the handlers validate with.
 */
import { defineSurface } from "@versionless/cli/surface/define";
import {
  teamSchema,
  userCreateSchema,
  userSchema,
} from "@versionless/db/schema/demo";
import { z } from "zod";
import { rpcRouter } from "./server/rpc";
import { demoApi } from "./versions";
import { DEMO_HTTP_ROUTES } from "./api-routes";

/** The registered change chain — the CLI reads coverage from this instance. */
export const versionless = demoApi;

const idParams = z.object({ id: z.string() });

export default defineSurface({
  orpc: [{ router: rpcRouter, mount: "/rpc" }],
  models: {
    User: userSchema,
    Team: teamSchema,
  },
  manual: [
    {
      method: DEMO_HTTP_ROUTES.users.method,
      path: DEMO_HTTP_ROUTES.users.path,
      response: z.array(userSchema),
    },
    {
      method: DEMO_HTTP_ROUTES.userById.method,
      path: "/users/:id",
      params: idParams,
      response: userSchema,
    },
    {
      method: DEMO_HTTP_ROUTES.createUser.method,
      path: DEMO_HTTP_ROUTES.createUser.path,
      body: userCreateSchema,
      response: userSchema,
    },
    {
      method: DEMO_HTTP_ROUTES.teams.method,
      path: DEMO_HTTP_ROUTES.teams.path,
      response: z.array(teamSchema),
    },
    {
      method: DEMO_HTTP_ROUTES.teamById.method,
      path: "/teams/:id",
      params: idParams,
      response: teamSchema,
    },
  ],
});
