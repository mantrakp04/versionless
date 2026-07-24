/**
 * In-memory fixture data for the versionless demo. Everything here is the
 * LATEST wire shape, typed from the single parent source — the drizzle
 * schema in @versionless/db (drizzle-zod derives the runtime validators,
 * z.infer derives these types). Handlers never see anything else.
 *
 * Kept in-memory so the demo works with zero setup; swapping to real
 * Postgres queries is a drop-in since the types already come from the db.
 */
import type { Team, User, UserCreate } from "@versionless/db/schema/demo";

export type { Team, User, UserCreate };

export const users: User[] = [
  { id: "u_1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  { id: "u_2", firstName: "Grace", lastName: "Hopper", email: "grace@example.com" },
  { id: "u_3", firstName: "Edsger", lastName: "Dijkstra", email: "edsger@example.com" },
];

export const teams: Team[] = [
  { id: "t_1", name: "Compilers", memberIds: ["u_1", "u_2"] },
  { id: "t_2", name: "Algorithms", memberIds: ["u_3"] },
];

let nextUserId = users.length + 1;

export function addUser(input: UserCreate): User {
  const user: User = { id: `u_${nextUserId++}`, ...input };
  users.push(user);
  return user;
}
