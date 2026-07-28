/**
 * The demo's route catalog. Each route declares only its method and path
 * pattern; the core route key (`"GET /users/:id"`) and the TanStack Start
 * adapter spelling (`"/users/$id"`) are derived, so the spellings of one route
 * can never drift apart. Literal types are preserved end-to-end, which is what
 * lets `v.change({ routes: [...] })` keep checking route keys against the
 * registered surface.
 */

/** `/users/:id` -> `/users/$id`, at the type level. */
type AdapterRoute<S extends string> = S extends `${infer Head}:${infer Tail}`
  ? `${Head}$${AdapterRoute<Tail>}`
  : S;

interface DemoRoute<M extends string, P extends string> {
  readonly method: M;
  /** Route pattern, e.g. `/users/:id`. */
  readonly path: P;
  /** TanStack Start file-route spelling, e.g. `/users/$id`. */
  readonly adapterRoute: AdapterRoute<P>;
  /** Core route key, e.g. `GET /users/:id`. */
  readonly key: `${M} ${P}`;
}

function route<const M extends string, const P extends string>(
  method: M,
  path: P,
): DemoRoute<M, P> {
  return {
    method,
    path,
    adapterRoute: path.split(":").join("$") as AdapterRoute<P>,
    key: `${method} ${path}`,
  };
}

export const DEMO_HTTP_ROUTES = {
  users: route("GET", "/users"),
  userById: route("GET", "/users/:id"),
  createUser: route("POST", "/users"),
  teams: route("GET", "/teams"),
  teamById: route("GET", "/teams/:id"),
  legacyOrgById: route("GET", "/orgs/:id"),
} as const;

export const DEMO_PROCEDURES = {
  userList: "demo.userList",
  userCreate: "demo.userCreate",
} as const;
