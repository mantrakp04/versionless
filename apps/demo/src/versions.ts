import type { User } from "@versionless/db/schema/demo";
import { DEMO_HTTP_ROUTES } from "./api-routes";
import { v } from "./versionless";
import orgsToTeams from "./changes/2025-06-01-orgs-to-teams";
import splitUserName, { type UserV1 } from "./changes/2026-05-14-split-user-name";

export { CURRENT_VERSION, v } from "./versionless";

/**
 * Direct jump for the oldest cohort: clients pinned exactly at 2025-01-01 get
 * one hand-written hop straight to current on the user list route instead of
 * the composed chain — exercised end-to-end to demonstrate jump priority.
 */
v.jump({
  from: "2025-01-01",
  to: "2026-07-21",
  describe: "direct 2025-01-01 -> current for GET /users",
  routes: [DEMO_HTTP_ROUTES.users.key],
  response: {
    down: (body: User[]): UserV1[] =>
      body.map(({ firstName, lastName, ...rest }) => ({
        ...rest,
        name: `${firstName} ${lastName}`.trim(),
      })),
  },
  examples: [
    {
      response: {
        current: [
          { id: "u_1", firstName: "Ada", lastName: "Lovelace", email: "ada@lovelace.dev" },
        ],
        old: [{ id: "u_1", name: "Ada Lovelace", email: "ada@lovelace.dev" }],
      },
    },
  ],
});

/** The registered change chain (ascending) — the input to ClientTypes. */
export const demoApi = v.register([orgsToTeams, splitUserName] as const);
