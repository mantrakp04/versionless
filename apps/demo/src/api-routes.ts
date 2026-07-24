export const DEMO_HTTP_ROUTES = {
  users: {
    method: "GET",
    path: "/users",
    matchedRoute: "/users",
    adapterRoute: "/users",
    key: "GET /users",
  },
  userById: {
    method: "GET",
    path: "/users/u_1",
    matchedRoute: "/users/:id",
    adapterRoute: "/users/$id",
    key: "GET /users/:id",
  },
  createUser: {
    method: "POST",
    path: "/users",
    matchedRoute: "/users",
    adapterRoute: "/users",
    key: "POST /users",
  },
  teams: {
    method: "GET",
    path: "/teams",
    matchedRoute: "/teams",
    adapterRoute: "/teams",
    key: "GET /teams",
  },
  teamById: {
    method: "GET",
    path: "/teams/t_1",
    matchedRoute: "/teams/:id",
    adapterRoute: "/teams/$id",
    key: "GET /teams/:id",
  },
  legacyOrgById: {
    method: "GET",
    path: "/orgs/t_1",
    matchedRoute: "/orgs/:id",
    adapterRoute: "/orgs/$id",
    key: "GET /orgs/:id",
  },
} as const;

export const DEMO_PROCEDURES = {
  userList: "demo.userList",
  userCreate: "demo.userCreate",
} as const;

export const DEMO_TELEMETRY_ROUTES = [
  DEMO_HTTP_ROUTES.users,
  DEMO_HTTP_ROUTES.userById,
  DEMO_HTTP_ROUTES.createUser,
  DEMO_HTTP_ROUTES.teams,
  DEMO_HTTP_ROUTES.teamById,
  ...Object.values(DEMO_PROCEDURES).map((procedure) => ({
    method: "TRPC" as const,
    procedure,
    key: `trpc:${procedure}`,
  })),
] as const;
