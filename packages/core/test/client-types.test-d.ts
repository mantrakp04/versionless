/**
 * Compile-time tests for the ClientTypes derivation. These assertions are
 * enforced by `tsc --noEmit` (check-types); bun test executes them as no-ops.
 */
import { describe, expect, test } from "bun:test";
import { expectTypeOf } from "expect-type";
import { createVersionless } from "../src/index";
import type {
  ChainError,
  ClientTypes,
  RouteClientTypes,
} from "../src/client-types";

const v = createVersionless({
  scheme: "date",
  current: "2026-07-21",
  resolve: [{ header: "x-api-version" }, { default: "current" }],
});

// --- fixture chain (annotated transforms; ascending) -----------------------

interface UserV1 {
  id: number;
  name: string;
}
interface UserV2 {
  id: string;
  name: string;
}
interface UserV3 {
  id: string;
  firstName: string;
  lastName: string;
}

const idsToStrings = v.change("2025-03-01", {
  describe: "ids became strings",
  routes: ["GET /users/:id"],
  request: {
    up: (body: { id: number }): { id: string } => ({ id: `u_${body.id}` }),
  },
  response: {
    down: (body: UserV2): UserV1 => ({ ...body, id: Number(body.id.slice(2)) }),
  },
});

const splitName = v.change("2026-05-14", {
  describe: "name split",
  routes: ["GET /users/:id", "POST /users"],
  request: {
    up: (body: { id: string }): { id: string } => body,
  },
  response: {
    down: (body: UserV3): UserV2 => ({
      id: body.id,
      name: `${body.firstName} ${body.lastName}`,
    }),
  },
});

const trpcSplit = v.change("2026-05-14", {
  describe: "trpc split",
  procedures: ["user.get"],
  output: {
    down: (body: UserV3): UserV2 => ({
      id: body.id,
      name: `${body.firstName} ${body.lastName}`,
    }),
  },
});

const api = v.register([idsToStrings, splitName, trpcSplit] as const);

// --- assertions ------------------------------------------------------------

describe("ClientTypes (compile-time)", () => {
  test("pinned below the floor composes the whole chain", () => {
    type T = ClientTypes<typeof api, "2025-03-01">;
    // 2025-03-01 client: 2026-05-14 change applies; its down yields UserV2.
    expectTypeOf<T["GET /users/:id"]>().toEqualTypeOf<{
      request: { id: string };
      response: UserV2;
    }>();
  });

  test("three-version span: oldest client sees the oldest wire shape", () => {
    type R = RouteClientTypes<typeof api.changes, "GET /users/:id", "floor">;
    // Both changes apply. Request = first up's param; response = first down's return.
    expectTypeOf<R>().toEqualTypeOf<{
      request: { id: number };
      response: UserV1;
    }>();
  });

  test("pinned at current: no transforms, current shapes pass through", () => {
    type T = ClientTypes<
      typeof api,
      "2026-07-21",
      { "GET /users/:id": { request: { id: string }; response: UserV3 } }
    >;
    expectTypeOf<T["GET /users/:id"]>().toEqualTypeOf<{
      request: { id: string };
      response: UserV3;
    }>();
  });

  test("tRPC procedures resolve by procedure name", () => {
    type T = ClientTypes<typeof api, "2025-03-01">;
    expectTypeOf<T["user.get"]["response"]>().toEqualTypeOf<UserV2>();
  });

  test("chain mismatch surfaces as ChainError", () => {
    const bad1 = v.change("2025-04-01", {
      describe: "bad chain a",
      routes: ["GET /broken"],
      request: { up: (body: { a: number }): { b: string } => ({ b: String(body.a) }) },
    });
    const bad2 = v.change("2025-05-01", {
      describe: "bad chain b",
      routes: ["GET /broken"],
      request: { up: (body: { c: boolean }): { d: number } => ({ d: body.c ? 1 : 0 }) },
    });
    const badApi = v.register([bad1, bad2] as const);
    type R = RouteClientTypes<typeof badApi.changes, "GET /broken", "floor">;
    expectTypeOf<R>().toMatchTypeOf<ChainError<{ b: string }, { c: boolean }>>();
  });

  test("wire phantom overrides inference", () => {
    const wired = v.change("2025-06-01", {
      describe: "wire override",
      routes: ["GET /wired"],
      request: { up: (body: any) => body },
      response: { down: (body: any) => body },
      wire: {} as {
        request: { old: { legacy: true } };
        response: { old: { legacyResponse: true } };
      },
    });
    const wiredApi = v.register([wired] as const);
    type R = RouteClientTypes<typeof wiredApi.changes, "GET /wired", "floor">;
    expectTypeOf<R>().toEqualTypeOf<{
      request: { legacy: true };
      response: { legacyResponse: true };
    }>();
  });
});

// Keep bun test happy with at least one runtime assertion.
test("fixture registers cleanly", () => {
  expect(api.changes.length).toBe(3);
});
