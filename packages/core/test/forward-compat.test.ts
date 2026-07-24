import { describe, expect, test } from "bun:test";
import { FutureVersionError } from "../src/errors";
import { createVersionless } from "../src/index";
import type { ExchangeInput } from "../src/types";

const CURRENT = "2026-07-21";

function api(onFutureVersion?: "clamp" | "reject") {
  const v = createVersionless({
    scheme: "date",
    current: CURRENT,
    resolve: [{ header: "x-api-version" }, { default: "current" }],
    ...(onFutureVersion ? { onFutureVersion } : {}),
  });
  v.change("2026-05-14", {
    describe: "name split",
    routes: ["GET /users/:id"],
    response: {
      down: ({ firstName, lastName, ...rest }: any) => ({
        ...rest,
        name: `${firstName} ${lastName}`.trim(),
      }),
    },
  });
  return v;
}

function input(version?: string): ExchangeInput {
  return {
    method: "GET",
    path: "/users/u_1",
    matchedRoute: "/users/:id",
    adapter: "test",
    getHeader: (name) =>
      name.toLowerCase() === "x-api-version" && version ? version : null,
  };
}

describe("forward compat: client pinned ahead of the server", () => {
  test("default policy clamps to current and advertises the drift", async () => {
    const ex = await api().openExchange(input("2027-01-01"));
    expect(ex.version).toBe(CURRENT);
    expect(ex.responseHeaders["x-api-version-served"]).toBe(CURRENT);
    expect(ex.responseHeaders["x-api-version-requested"]).toBe("2027-01-01");
    // Clamped to current — no transforms apply.
    expect(ex.transformCount).toBe(0);
  });

  test("reject policy throws FutureVersionError with a stable code", async () => {
    expect(() => api("reject").openExchange(input("2027-01-01"))).toThrow(
      FutureVersionError,
    );
    try {
      await api("reject").openExchange(input("2027-01-01"));
      throw new Error("unreachable");
    } catch (err) {
      const e = err as FutureVersionError;
      expect(e.code).toBe("VERSION_AHEAD");
      expect(e.requested).toBe("2027-01-01");
      expect(e.current).toBe(CURRENT);
    }
  });

  test("reject policy leaves valid pinned clients untouched", async () => {
    const ex = await api("reject").openExchange(input("2025-01-01"));
    expect(ex.version).toBe("2025-01-01");
    expect(ex.responseHeaders).toEqual({ "x-api-version-served": "2025-01-01" });
  });

  test("unpinned clients always get the served-version header", async () => {
    const ex = await api().openExchange(input());
    expect(ex.version).toBe(CURRENT);
    expect(ex.responseHeaders).toEqual({ "x-api-version-served": CURRENT });
  });
});
