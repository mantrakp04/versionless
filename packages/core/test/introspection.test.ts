import { describe, expect, test } from "bun:test";

import { createVersionless } from "../src/index";
import { ChangeRegistry } from "../src/registry";
import { dateScheme } from "../src/scheme";
import type { Change, ChangeMeta, Jump } from "../src/types";

function makeInstance() {
  const v = createVersionless({
    scheme: "date",
    current: "2026-07-21",
    resolve: [{ default: "current" }],
  });
  v.change("2026-05-14", {
    describe: "split name into firstName/lastName",
    routes: ["GET /users/:id"],
    request: { up: (body: unknown) => body },
    response: { down: (body: unknown) => body },
    schema: (s) => s.on("User", { removed: ["name"] }),
  });
  v.change("2025-06-01", {
    describe: "orgs -> teams",
    rewrite: { from: "GET /orgs/:id", to: "GET /teams/:id" },
  });
  v.jump({ from: "2025-01-01", to: "2026-05-14", describe: "hop" });
  v.sunset("2025-06-01", { after: "2027-01-31", message: "Upgrade." });
  v.sunset("2025-01-01", { after: "2026-09-30" });
  return v;
}

describe("instance introspection", () => {
  test("versions() answers on an UNSEALED instance", () => {
    // The build tooling case: import the entry, read the chain, never serve a
    // request. Nothing has sealed the registry, so a naive read of the
    // seal-populated `releaseVersions` field would return [].
    const v = makeInstance();
    expect(v._registry.isSealed).toBe(false);
    expect(v._registry.releaseVersions).toEqual([]);
    expect(v.versions()).toEqual([
      "2025-01-01",
      "2025-06-01",
      "2026-05-14",
      "2026-07-21",
    ]);
  });

  test("versions() does not seal, so later registration still works", () => {
    const v = makeInstance();
    v.versions();
    expect(() => v.change("2026-06-01", { describe: "late" })).not.toThrow();
    expect(v.versions()).toContain("2026-06-01");
  });

  test("versions() on a bare instance is just current", () => {
    const v = createVersionless({
      scheme: "date",
      current: "2026-07-21",
      resolve: [{ default: "current" }],
    });
    expect(v.versions()).toEqual(["2026-07-21"]);
  });

  test("versions() agrees with the sealed releaseVersions field", async () => {
    const v = makeInstance();
    const before = v.versions();
    await v.openExchange({
      method: "GET",
      path: "/users/1",
      getHeader: () => null,
    });
    const registry = v._registry;
    expect(registry.isSealed).toBe(true);
    expect(registry.releaseVersions).toEqual(before);
    expect(v.versions()).toEqual(before);
  });

  test("chain() returns changes ascending, then jumps", () => {
    const v = makeInstance();
    const chain = v.chain();
    expect(
      chain.map((step) =>
        step.kind === "jump" ? `${step.from}->${step.to}` : step.version,
      ),
    ).toEqual(["2025-06-01", "2026-05-14", "2025-01-01->2026-05-14"]);
    const split = chain.find((c) => c.version === "2026-05-14")!;
    expect(split.routes).toEqual(["GET /users/:*"]);
    expect(split.hasUp).toBe(true);
    expect(split.hasDown).toBe(true);
    expect(split.lossy).toBe(false);
    expect(split.declarations).toEqual([{ model: "User", removed: ["name"] }]);
  });

  test("chain() hands back a copy — callers cannot grow the registry", () => {
    const v = makeInstance();
    const chain = v.chain() as ChangeMeta[];
    chain.push({
      kind: "change",
      version: "2026-07-01",
      describe: "smuggled",
      routes: [],
      lossy: false,
      hasUp: false,
      hasDown: false,
      declarations: [],
    });
    expect(v.chain()).toHaveLength(3);
  });

  test("sunsets() returns every registered sunset, defensively copied", () => {
    const v = makeInstance();
    expect(v.sunsets()).toEqual([
      { version: "2025-06-01", after: "2027-01-31", message: "Upgrade." },
      { version: "2025-01-01", after: "2026-09-30" },
    ]);
    // An absent message stays absent rather than becoming an explicit
    // `undefined` — snapshot bytes are compared for equality downstream.
    expect(Object.hasOwn(v.sunsets()[1]!, "message")).toBe(false);
    // The declared type is readonly, so this cast is what a caller would have
    // to write on purpose; the runtime copy is the second line of defence.
    const copy = v.sunsets() as unknown as { after: string }[];
    copy[0]!.after = "1999-01-01";
    copy.length = 0;
    expect(v.sunsets()).toHaveLength(2);
    expect(v.sunsets()[0]!.after).toBe("2027-01-31");
  });

  test("sunsets() is empty — not absent — when none are registered", () => {
    const v = createVersionless({
      scheme: "date",
      current: "2026-07-21",
      resolve: [{ default: "current" }],
    });
    expect(v.sunsets()).toEqual([]);
  });

  test("Change and Jump both satisfy the ChangeMeta contract", () => {
    const r = new ChangeRegistry(dateScheme, "2026-07-21");
    const change: Change = r.addChange("2026-05-14", { describe: "c" });
    const jump: Jump = r.addJump({ from: "2025-01-01", to: "2026-05-14" });
    // Compile-time: this is the assignability the CLI depends on when it
    // merges instance steps with standalone exported ones.
    const meta: ChangeMeta[] = [change, jump];
    expect(meta.map((m) => m.kind)).toEqual(["change", "jump"]);
  });
});
