/**
 * The demo's HTTP surface — plain web-standard handlers wrapped with the
 * versionless TanStack Start adapter, defined outside the route files so the
 * wire tests (and the /orgs rewrite alias) can exercise the exact handler
 * maps the routes mount. Handlers speak ONLY the latest wire shape —
 * versioning happens in the wrapper.
 */
import {
  versionless,
  type ServerRouteHandler,
} from "@versionless/adapter-tanstack-start";
import { userCreateSchema } from "@versionless/db/schema/demo";
import { DEMO_HTTP_ROUTES } from "../api-routes";
import { addUser, teams, users } from "../data";
// Import the instance through versions.ts, not versionless.ts: importing the
// chain module is what REGISTERS the changes — a bare instance serves
// identity transforms.
import { v } from "../versions";

export const usersHandlers = versionless(
  v,
  {
    GET: async () => Response.json(users),
    POST: async ({ request }) => {
      const body = userCreateSchema.safeParse(await request.json());
      if (!body.success) {
        return Response.json({ error: "invalid_user" }, { status: 422 });
      }
      return Response.json(addUser(body.data));
    },
  },
  { route: DEMO_HTTP_ROUTES.users.adapterRoute },
);

export const userByIdHandlers = versionless(
  v,
  {
    GET: async ({ request }) => {
      const id = new URL(request.url).pathname.split("/").pop();
      const user = users.find((u) => u.id === id);
      return user
        ? Response.json(user)
        : Response.json({ error: "user_not_found" }, { status: 404 });
    },
  },
  { route: DEMO_HTTP_ROUTES.userById.adapterRoute },
);

export const teamsHandlers = versionless(
  v,
  {
    GET: async () => Response.json(teams),
  },
  { route: DEMO_HTTP_ROUTES.teams.adapterRoute },
);

/**
 * Exported unwrapped too: the /orgs/:id rewrite alias dispatches here and the
 * target opens its own exchange (see routes/orgs.$id.ts).
 */
export const teamByIdGET: ServerRouteHandler = async ({ request }) => {
  const id = new URL(request.url).pathname.split("/").pop();
  const team = teams.find((t) => t.id === id);
  return team
    ? Response.json(team)
    : Response.json({ error: "team_not_found" }, { status: 404 });
};

export const teamByIdHandlers = versionless(
  v,
  { GET: teamByIdGET },
  { route: DEMO_HTTP_ROUTES.teamById.adapterRoute },
);
