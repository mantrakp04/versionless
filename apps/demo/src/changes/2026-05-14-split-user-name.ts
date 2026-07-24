import type { User, UserCreate } from "@versionless/db/schema/demo";
import { DEMO_HTTP_ROUTES, DEMO_PROCEDURES } from "../api-routes";
import { v } from "../versionless";

/**
 * Old wire shapes are DERIVED from the current ones — never redefined.
 * One parent source (the drizzle schema) feeds current types; changes
 * describe deltas with Omit/&.
 */
export type UserV1 = Omit<User, "firstName" | "lastName"> & { name: string };
export type UserCreateV1 = Omit<UserCreate, "firstName" | "lastName"> & {
  name: string;
};

function mergeName({ firstName, lastName, ...rest }: User): UserV1 {
  return { ...rest, name: `${firstName} ${lastName}`.trim() };
}

function splitName({ name, ...rest }: UserCreateV1): UserCreate {
  const [firstName, ...restName] = name.split(" ");
  return { ...rest, firstName: firstName ?? "", lastName: restName.join(" ") };
}

export default v.change("2026-05-14", {
  describe: "user.name split into firstName/lastName",
  routes: [
    DEMO_HTTP_ROUTES.users.key,
    DEMO_HTTP_ROUTES.userById.key,
    DEMO_HTTP_ROUTES.createUser.key,
  ],
  procedures: Object.values(DEMO_PROCEDURES),

  request: {
    up: (body: UserCreateV1): UserCreate => splitName(body),
  },
  response: {
    down: (body: User | User[]): UserV1 | UserV1[] =>
      Array.isArray(body) ? body.map(mergeName) : mergeName(body),
  },

  schema: (s) =>
    s.on("User", { removed: ["name"], added: ["firstName", "lastName"] }),

  // Wire-shape fixtures for `versionless verify`: up(old) === current,
  // down(current) === old, plus the tolerant-reader probe (unknown fields
  // must survive both transforms).
  examples: [
    {
      request: {
        old: { name: "Ada Lovelace", email: "ada@lovelace.dev" },
        current: {
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@lovelace.dev",
        },
      },
      response: {
        current: {
          id: "u_1",
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@lovelace.dev",
        },
        old: { id: "u_1", name: "Ada Lovelace", email: "ada@lovelace.dev" },
      },
    },
  ],
});
