import { describe, expect, test } from "bun:test";
import { createVersionless } from "../src/index";
import { deepEqual, verifyChain, verifyChange } from "../src/integrity";

const CURRENT = "2026-07-21";

function api() {
  return createVersionless({
    scheme: "date",
    current: CURRENT,
    resolve: [{ header: "x-api-version" }, { default: "current" }],
  });
}

describe("deepEqual", () => {
  test("ignores key order and treats undefined as absent", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, { x: "y" }], [1, { x: "y" }])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe("verifyChange: fixture equality", () => {
  test("passing up and down fixtures produce no issues", async () => {
    const v = api();
    const change = v.change("2026-05-14", {
      describe: "name split into firstName/lastName",
      routes: ["GET /users/:id"],
      request: {
        up: ({ name, ...rest }: any) => {
          const [firstName, ...restName] = String(name).split(" ");
          return { ...rest, firstName, lastName: restName.join(" ") };
        },
      },
      response: {
        down: ({ firstName, lastName, ...rest }: any) => ({
          ...rest,
          name: `${firstName} ${lastName}`.trim(),
        }),
      },
      examples: [
        {
          request: {
            old: { name: "Ada Lovelace", plan: "pro" },
            current: { firstName: "Ada", lastName: "Lovelace", plan: "pro" },
          },
          response: {
            current: { id: "u_1", firstName: "Ada", lastName: "Lovelace" },
            old: { id: "u_1", name: "Ada Lovelace" },
          },
        },
      ],
    });
    const report = await verifyChange(change);
    expect(report.issues).toEqual([]);
    // 2 equality assertions + 2 probe assertions.
    expect(report.assertions).toBe(4);
  });

  test("a wrong fixture is reported with expected/actual", async () => {
    const v = api();
    const change = v.change("2026-05-14", {
      describe: "bad fixture",
      routes: ["GET /x"],
      request: { up: (body: any) => ({ ...body, added: true }) },
      examples: [
        { request: { old: { a: 1 }, current: { a: 1, added: false } } },
      ],
    });
    const report = await verifyChange(change);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]!.kind).toBe("example-mismatch");
    expect(report.issues[0]!.direction).toBe("up");
    expect(report.issues[0]!.actual).toEqual({ a: 1, added: true });
  });

  test("async transforms are awaited", async () => {
    const v = api();
    const change = v.change("2026-05-14", {
      describe: "async up",
      routes: ["GET /x"],
      request: { up: async (body: any) => ({ ...body, async: true }) },
      examples: [{ request: { old: { a: 1 }, current: { a: 1, async: true } } }],
    });
    const report = await verifyChange(change);
    expect(report.issues).toEqual([]);
  });

  test("a throwing transform is reported, not thrown", async () => {
    const v = api();
    const change = v.change("2026-05-14", {
      describe: "explodes",
      routes: ["GET /x"],
      response: {
        down: () => {
          throw new Error("boom");
        },
      },
      examples: [{ response: { current: { a: 1 }, old: { a: 1 } } }],
    });
    const report = await verifyChange(change);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]!.kind).toBe("transform-threw");
    expect(report.issues[0]!.message).toContain("boom");
  });
});

describe("verifyChange: tolerant-reader probe", () => {
  test("a transform that rebuilds the object drops the probe and fails", async () => {
    const v = api();
    const change = v.change("2026-05-14", {
      describe: "rebuilds instead of spreading",
      routes: ["GET /x"],
      response: {
        // Anti-pattern: field-by-field rebuild silently drops unknown fields.
        down: (body: any) => ({ id: body.id }),
      },
      examples: [{ response: { current: { id: 1 }, old: { id: 1 } } }],
    });
    const report = await verifyChange(change);
    expect(report.issues.map((i) => i.kind)).toEqual(["probe-dropped"]);
  });

  test("lossy changes are exempt from the probe", async () => {
    const v = api();
    const change = v.change("2026-05-14", {
      describe: "declared lossy",
      routes: ["GET /x"],
      lossy: true,
      response: { down: (body: any) => ({ id: body.id }) },
      examples: [{ response: { current: { id: 1, extra: "x" }, old: { id: 1 } } }],
    });
    const report = await verifyChange(change);
    expect(report.issues).toEqual([]);
  });
});

describe("verifyChange: coverage reporting", () => {
  test("transforms without examples are flagged as missing-examples", async () => {
    const v = api();
    const change = v.change("2026-05-14", {
      describe: "unexercised",
      routes: ["GET /x"],
      request: { up: (body: any) => body },
    });
    const report = await verifyChange(change);
    expect(report.issues.map((i) => i.kind)).toEqual(["missing-examples"]);
    expect(report.unexercised).toEqual(["2026-05-14"]);
  });

  test("a change with no transforms needs no examples", async () => {
    const v = api();
    const change = v.change("2025-06-01", {
      describe: "pure rewrite",
      rewrite: { from: "GET /orgs/:id", to: "GET /teams/:id" },
    });
    const report = await verifyChange(change);
    expect(report.issues).toEqual([]);
  });

  test("an example pointing at a transform the change lacks is invalid", async () => {
    const v = api();
    const change = v.change("2026-05-14", {
      describe: "response-only",
      routes: ["GET /x"],
      response: { down: (body: any) => body },
      examples: [{ request: { old: { a: 1 }, current: { a: 1 } } }],
    });
    const report = await verifyChange(change);
    expect(report.issues.map((i) => i.kind)).toEqual(["invalid-example"]);
  });
});

describe("verifyChain", () => {
  test("aggregates across changes and jumps", async () => {
    const v = api();
    const good = v.change("2025-09-01", {
      describe: "good",
      routes: ["GET /x"],
      request: { up: (body: any) => ({ ...body, v2: true }) },
      examples: [{ request: { old: { a: 1 }, current: { a: 1, v2: true } } }],
    });
    const jump = v.jump({
      from: "2025-09-01",
      to: "2026-05-14",
      routes: ["GET /x"],
      response: { down: (body: any) => body },
      examples: [{ response: { current: { a: 1 }, old: { a: 1 } } }],
    });
    const bad = v.change("2026-05-14", {
      describe: "bad",
      routes: ["GET /y"],
      request: { up: (body: any) => body },
    });
    const report = await verifyChain([good, jump, bad]);
    expect(report.issues.map((i) => i.kind)).toEqual(["missing-examples"]);
    expect(report.unexercised).toEqual(["2026-05-14"]);
    expect(report.assertions).toBeGreaterThan(0);
  });
});
