import { describe, expect, test } from "bun:test";
import { ChangeRegistry } from "../src/registry";
import { dateScheme } from "../src/scheme";

function makeRegistry() {
  return new ChangeRegistry(dateScheme, "2026-07-21");
}

describe("ChangeRegistry", () => {
  test("keeps changes sorted ascending regardless of registration order", () => {
    const r = makeRegistry();
    r.addChange("2026-05-14", { describe: "b", routes: ["GET /users/:id"] });
    r.addChange("2025-01-01", { describe: "a", routes: ["GET /users/:id"] });
    r.addChange("2025-06-01", { describe: "c", routes: ["GET /users/:id"] });
    expect(r.changes.map((c) => c.version)).toEqual([
      "2025-01-01",
      "2025-06-01",
      "2026-05-14",
    ]);
    expect(
      r.routeChanges("GET /users/:*")!.changes.map((c) => c.version),
    ).toEqual(["2025-01-01", "2025-06-01", "2026-05-14"]);
  });

  test("dedupes re-registration (hot reload)", () => {
    const r = makeRegistry();
    const a = r.addChange("2025-01-01", { describe: "same" });
    const b = r.addChange("2025-01-01", { describe: "same" });
    expect(a).toBe(b);
    expect(r.changes).toHaveLength(1);
  });

  test("rejects changes newer than current, invalid versions, post-seal registration", () => {
    const r = makeRegistry();
    expect(() => r.addChange("2027-01-01", { describe: "future" })).toThrow();
    expect(() => r.addChange("2026-5-14", { describe: "bad" })).toThrow();
    r.seal();
    expect(() => r.addChange("2025-01-01", { describe: "late" })).toThrow();
  });

  test("procedures index under trpc: keys", () => {
    const r = makeRegistry();
    r.addChange("2026-05-14", { describe: "split", procedures: ["user.get"] });
    expect(r.routeChanges("trpc:user.get")!.changes).toHaveLength(1);
  });

  test("compiles schema declarations", () => {
    const r = makeRegistry();
    const c = r.addChange("2026-05-14", {
      describe: "split user.name",
      schema: (s) =>
        s.on("User", { removed: ["name"], added: ["firstName", "lastName"] }),
    });
    expect(c.declarations).toEqual([
      { model: "User", removed: ["name"], added: ["firstName", "lastName"] },
    ]);
  });

  test("effectiveVersion normalizes to nearest release at-or-before", () => {
    const r = makeRegistry();
    r.addChange("2025-01-01", { describe: "a" });
    r.addChange("2026-05-14", { describe: "b" });
    r.seal();
    expect(r.effectiveVersion("2026-05-14")).toBe("2026-05-14");
    expect(r.effectiveVersion("2026-01-01")).toBe("2025-01-01");
    expect(r.effectiveVersion("2026-07-21")).toBe("2026-07-21");
    // Older than the floor: passes through unchanged.
    expect(r.effectiveVersion("2024-01-01")).toBe("2024-01-01");
  });

  test("jump validation", () => {
    const r = makeRegistry();
    expect(() =>
      r.addJump({ from: "2026-05-14", to: "2025-01-01" }),
    ).toThrow();
    const j = r.addJump({
      from: "2025-01-01",
      to: "2026-07-21",
      routes: ["GET /users/:id"],
    });
    expect(j.routes).toEqual(["GET /users/:*"]);
    expect(r.routeChanges("GET /users/:*")!.jumps).toHaveLength(1);
  });

  test("rewrites match only for clients older than the rewrite change", () => {
    const r = makeRegistry();
    r.addChange("2025-06-01", {
      describe: "orgs -> teams",
      rewrite: { from: "GET /orgs/:id", to: "GET /teams/:id" },
    });
    r.seal();
    const hit = r.matchRewrite("GET", "/orgs/42", "2025-01-01");
    expect(hit).not.toBeNull();
    expect(hit!.params).toEqual({ id: "42" });
    expect(hit!.rewrite.toRouteKey).toBe("GET /teams/:*");
    // Clients at or past the rewrite version call /teams directly.
    expect(r.matchRewrite("GET", "/orgs/42", "2025-06-01")).toBeNull();
  });

  test("matchChangedRoute finds patterns from raw paths", () => {
    const r = makeRegistry();
    r.addChange("2026-05-14", {
      describe: "split",
      routes: ["GET /users/:id", "POST /users"],
    });
    expect(r.matchChangedRoute("GET", "/users/42")).toBe("GET /users/:*");
    expect(r.matchChangedRoute("POST", "/users")).toBe("POST /users");
    expect(r.matchChangedRoute("GET", "/teams/42")).toBeNull();
  });
});
