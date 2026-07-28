import { describe, expect, test } from "bun:test";
import { fnv1a, stableStringify } from "@versionless/core";

process.env.SKIP_ENV_VALIDATION = "1";

const {
  createVersionUploadApp,
  parseSnapshotSunsets,
  parseVersionSnapshot,
} = await import("../src/versions");

const snapshotContent = {
  formatVersion: 1 as const,
  version: "2026-07-24",
  tool: "@versionless/cli",
  models: {},
  endpoints: {},
};
const snapshot = {
  ...snapshotContent,
  integrity: {
    algo: "fnv1a-32" as const,
    hash: fnv1a(stableStringify(snapshotContent)),
  },
};

function request(body: unknown = snapshot) {
  return new Request("http://localhost/v1/versions", {
    method: "POST",
    headers: {
      authorization: "Bearer vl_team_secret",
      "content-type": "application/json",
      "x-versionless-project": "billing-api",
    },
    body: JSON.stringify(body),
  });
}

describe("version snapshot validation", () => {
  test("accepts a canonical generated snapshot", () => {
    expect(parseVersionSnapshot(snapshot)).toEqual(snapshot);
  });

  test("rejects missing integrity and malformed versions", () => {
    expect(parseVersionSnapshot({ ...snapshot, integrity: undefined })).toBe(
      null,
    );
    expect(parseVersionSnapshot({ ...snapshot, version: "../secret" })).toBe(
      null,
    );
  });

  test("rejects content changed without recomputing its integrity hash", () => {
    expect(
      parseVersionSnapshot({
        ...snapshot,
        endpoints: { "GET /admin": { response: "secret" } },
      }),
    ).toBe(null);
  });
});

describe("snapshot sunset schedule", () => {
  test("distinguishes an absent schedule from an empty one", () => {
    // Absent means "this CLI does not report sunsets" — clearing a project's
    // retirement dates on an old-CLI upload would silently un-deprecate an
    // API. Empty means "the customer declares none", which does clear it.
    expect(parseSnapshotSunsets(undefined)).toBe(null);
    expect(parseSnapshotSunsets([])).toEqual([]);
  });

  test("accepts a declared schedule with and without a message", () => {
    expect(
      parseSnapshotSunsets([
        { version: "2025-01-01", after: "2026-12-31", message: "Upgrade." },
        { version: "2024-01-01", after: "2026-06-30" },
      ]),
    ).toEqual([
      { version: "2025-01-01", after: "2026-12-31", message: "Upgrade." },
      { version: "2024-01-01", after: "2026-06-30" },
    ]);
  });

  test("rejects a malformed schedule rather than partially applying it", () => {
    // A rejected payload leaves the stored schedule untouched, so a corrupt
    // entry cannot retire a cohort early or drop an existing retirement.
    expect(parseSnapshotSunsets([{ version: "2025-01-01" }])).toBe(null);
    expect(
      parseSnapshotSunsets([{ version: "../etc", after: "2026-12-31" }]),
    ).toBe(null);
    expect(
      parseSnapshotSunsets([{ version: "2025-01-01", after: "31/12/2026" }]),
    ).toBe(null);
    expect(
      parseSnapshotSunsets([{ version: "2025-01-01", after: "2026-13-45" }]),
    ).toBe(null);
    expect(
      parseSnapshotSunsets([
        { version: "2025-01-01", after: "2026-12-31" },
        { version: "2025-01-01", after: "2027-01-01" },
      ]),
    ).toBe(null);
    expect(
      parseSnapshotSunsets(
        Array.from({ length: 65 }, (_, index) => ({
          version: `2025-01-${String((index % 28) + 1).padStart(2, "0")}`,
          after: "2026-12-31",
        })),
      ),
    ).toBe(null);
  });

  test("keeps a snapshot with sunsets a valid snapshot", () => {
    const withSunsets = {
      ...snapshot,
      sunsets: [{ version: "2025-01-01", after: "2026-12-31" }],
    };
    expect(parseVersionSnapshot(withSunsets)).toEqual(withSunsets);
    // And one without them still parses — the field is optional.
    expect(parseVersionSnapshot(snapshot)).toEqual(snapshot);
  });
});

describe("version upload API", () => {
  test("authenticates the build key and stores the generated file", async () => {
    let saved:
      | { projectId: string; value: typeof snapshot }
      | undefined;
    const app = createVersionUploadApp({
      authorize: async (authorization, project) => {
        expect(authorization).toBe("Bearer vl_team_secret");
        expect(project).toBe("billing-api");
        return {
          teamId: "team_1",
          projectId: "11111111-1111-4111-8111-111111111111",
        };
      },
      save: async (projectId, value) => {
        saved = { projectId, value: value as typeof snapshot };
        return "created";
      },
    });

    const response = await app.handle(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      projectId: "11111111-1111-4111-8111-111111111111",
      version: "2026-07-24",
      created: true,
    });
    expect(saved).toEqual({
      projectId: "11111111-1111-4111-8111-111111111111",
      value: snapshot,
    });
  });

  test("fails closed with public-safe errors", async () => {
    const unauthorized = createVersionUploadApp({
      authorize: async () => null,
      save: async () => {
        throw new Error("must not run");
      },
    });
    const denied = await unauthorized.handle(request());
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({
      error: "The API key cannot upload this version.",
    });

    const conflict = createVersionUploadApp({
      authorize: async () => ({
        teamId: "team_1",
        projectId: "11111111-1111-4111-8111-111111111111",
      }),
      save: async () => "conflict",
    });
    const rejected = await conflict.handle(request());
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({
      error:
        "That project version already exists with a different API surface.",
    });

    const diagnostics: unknown[] = [];
    const unavailable = createVersionUploadApp({
      authorize: async () => {
        throw new Error("postgresql://user:secret@private-db/versionless");
      },
      save: async () => "created",
      reportError: (error) => diagnostics.push(error),
    });
    const failed = await unavailable.handle(request());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: "This service is temporarily unavailable. Please try again shortly.",
    });
    expect(diagnostics).toHaveLength(1);
  });
});
