import { describe, expect, test } from "bun:test";

import type { ChangeMeta } from "@versionless/core";

import { matchCoverage } from "../src/coverage/match";
import type { DiffEntry } from "../src/diff/diff";

const LAST = "2026-01-01";

function entry(overrides: Partial<DiffEntry> = {}): DiffEntry {
  return {
    op: "field-removed",
    severity: "breaking",
    model: "User",
    endpoint: "GET /users/:id",
    location: "responses.200",
    polarity: "out",
    fieldPath: "name",
    requires: "down",
    ...overrides,
  };
}

function change(overrides: Partial<ChangeMeta> = {}): ChangeMeta {
  return {
    kind: "change",
    version: "2026-02-01",
    describe: "remove name",
    routes: [],
    lossy: false,
    hasUp: false,
    hasDown: true,
    declarations: [{ model: "User", removed: ["name"] }],
    ...overrides,
  };
}

describe("matchCoverage", () => {
  test("declared field removal with a down() is covered", () => {
    const report = matchCoverage([entry()], [change()], LAST);
    expect(report.pass).toBe(true);
    expect(report.covered).toHaveLength(1);
    expect(report.covered[0]?.by?.describe).toBe("remove name");
    expect(report.uncovered).toHaveLength(0);
    expect(report.stale).toHaveLength(0);
  });

  test("no candidate changes → uncovered, fail", () => {
    const report = matchCoverage([entry()], [], LAST);
    expect(report.pass).toBe(false);
    expect(report.uncovered).toHaveLength(1);
  });

  test("changes at or before the snapshot version are not candidates", () => {
    const report = matchCoverage([entry()], [change({ version: "2026-01-01" })], LAST);
    expect(report.pass).toBe(false);
    expect(report.uncovered).toHaveLength(1);
  });

  test("wrong direction → uncovered with a specific reason", () => {
    const report = matchCoverage(
      [entry()],
      [change({ hasDown: false, hasUp: true })],
      LAST,
    );
    expect(report.pass).toBe(false);
    expect(report.uncovered[0]?.reason).toBe(
      "change 2026-02-01 declares User.name but has no down()",
    );
  });

  test("lossy coverage downgrades a fail to a warning", () => {
    const report = matchCoverage([entry()], [change({ lossy: true })], LAST);
    expect(report.pass).toBe(true);
    expect(report.uncovered).toHaveLength(0);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.reason).toContain("lossy");
  });

  test("--strict-lossy flips lossy coverage back to a failure", () => {
    const report = matchCoverage([entry()], [change({ lossy: true })], LAST, {
      strictLossy: true,
    });
    expect(report.pass).toBe(false);
    expect(report.uncovered).toHaveLength(1);
    expect(report.uncovered[0]?.reason).toContain("--strict-lossy");
  });

  test("a non-lossy candidate wins over a lossy one", () => {
    const report = matchCoverage(
      [entry()],
      [change({ lossy: true }), change({ describe: "clean", lossy: false })],
      LAST,
    );
    expect(report.pass).toBe(true);
    expect(report.covered[0]?.by?.describe).toBe("clean");
    expect(report.warnings).toHaveLength(0);
  });

  test("stale declaration (matches no observed diff) warns", () => {
    const report = matchCoverage(
      [entry()],
      [
        change({
          declarations: [
            { model: "User", removed: ["name"] },
            { model: "User", removed: ["nmae"] }, // typo
          ],
        }),
      ],
      LAST,
    );
    expect(report.pass).toBe(true);
    expect(report.stale).toHaveLength(1);
    expect(report.stale[0]?.reason).toContain("typo?");
  });

  test("partial declaration: removed name+age but only name declared → age fails", () => {
    const entries = [entry(), entry({ fieldPath: "age" })];
    const report = matchCoverage(entries, [change()], LAST);
    expect(report.pass).toBe(false);
    expect(report.covered).toHaveLength(1);
    expect(report.uncovered).toHaveLength(1);
    expect(report.uncovered[0]?.entry.fieldPath).toBe("age");
  });

  test("a jump with declarations covers entries (candidacy via `to`)", () => {
    const jump = change({
      kind: "jump",
      version: undefined,
      from: "2025-06-01",
      to: "2026-03-01",
    });
    const report = matchCoverage([entry()], [jump], LAST);
    expect(report.pass).toBe(true);
    expect(report.covered[0]?.by?.kind).toBe("jump");
  });

  test("route-scoped change only covers entries on its routes (params normalized)", () => {
    const scoped = change({ routes: ["GET /users/:userId"] });
    const onRoute = entry();
    const offRoute = entry({ endpoint: "GET /admins/:id" });
    const report = matchCoverage([onRoute, offRoute], [scoped], LAST);
    expect(report.covered).toHaveLength(1);
    expect(report.covered[0]?.entry.endpoint).toBe("GET /users/:id");
    expect(report.uncovered).toHaveLength(1);
    expect(report.uncovered[0]?.entry.endpoint).toBe("GET /admins/:id");
  });

  test("endpoint-removed is covered by routesRemoved", () => {
    const removed = entry({
      op: "endpoint-removed",
      model: undefined,
      fieldPath: undefined,
      location: "endpoint",
    });
    const report = matchCoverage(
      [removed],
      [change({ declarations: [{ model: "User", routesRemoved: ["GET /users/:id"] }] })],
      LAST,
    );
    expect(report.pass).toBe(true);
    expect(report.covered).toHaveLength(1);
  });

  test("model-less entries need a route-targeted change with transforms", () => {
    const anonymous = entry({ model: undefined, fieldPath: "title" });
    // Model-declaration-only change (no routes) cannot cover it:
    const declOnly = change({ routes: [] });
    expect(matchCoverage([anonymous], [declOnly], LAST).pass).toBe(false);
    // A route-targeted change with the right transform can:
    const routed = change({ routes: ["GET /users/:id"], declarations: [] });
    const report = matchCoverage([anonymous], [routed], LAST);
    expect(report.pass).toBe(true);
    expect(report.covered).toHaveLength(1);
  });

  test("warning entries land in warnings when uncovered but never fail the run", () => {
    const warning = entry({
      op: "enum-value-added",
      severity: "warning",
      requires: null,
      fieldPath: "status",
    });
    const report = matchCoverage([warning], [], LAST);
    expect(report.pass).toBe(true);
    expect(report.warnings).toHaveLength(1);
  });

  test("warning entries can be covered by a typeChanged declaration", () => {
    const warning = entry({
      op: "enum-value-added",
      severity: "warning",
      requires: null,
      fieldPath: "status",
    });
    const report = matchCoverage(
      [warning],
      [change({ declarations: [{ model: "User", typeChanged: ["status"] }] })],
      LAST,
    );
    expect(report.pass).toBe(true);
    expect(report.covered).toHaveLength(1);
    expect(report.warnings).toHaveLength(0);
  });

  test("renamed declarations cover both the remove and the add side", () => {
    const removedSide = entry();
    const addedSide = entry({ op: "field-added", fieldPath: "fullName", severity: "breaking", requires: "up", polarity: "in", location: "body" });
    const renames = change({
      hasUp: true,
      hasDown: true,
      declarations: [{ model: "User", renamed: { name: "fullName" } }],
    });
    const report = matchCoverage([removedSide, addedSide], [renames], LAST);
    expect(report.pass).toBe(true);
    expect(report.covered).toHaveLength(2);
  });

  test("additive and neutral entries are ignored", () => {
    const additive = entry({
      op: "field-added",
      severity: "additive",
      requires: null,
    });
    const neutral = entry({ op: "type-changed", severity: "neutral", requires: null });
    const report = matchCoverage([additive, neutral], [], LAST);
    expect(report.pass).toBe(true);
    expect(report.covered).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
    expect(report.uncovered).toHaveLength(0);
  });
});
