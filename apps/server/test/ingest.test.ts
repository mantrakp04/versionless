import { describe, expect, setSystemTime, test } from "bun:test";

process.env.SKIP_ENV_VALIDATION = "1";
const {
  configuredIngestKeys,
  createOtlpAuthApp,
  createOtlpAuthorizer,
  LAST_SEEN_REFRESH_INTERVAL_MS,
  lastSeenNeedsRefresh,
} = await import("../src/ingest");

function request(
  authorization: string | undefined = "Bearer vl_account1_secret",
  project = "billing-api",
) {
  const headers = new Headers({ "x-versionless-project": project });
  if (authorization) headers.set("authorization", authorization);
  return new Request("http://localhost/internal/otlp/auth/v1/logs", {
    headers,
  });
}

describe("ingest key configuration", () => {
  test("keeps the demo key development-only", () => {
    expect(configuredIngestKeys(undefined, "development").size).toBe(1);
    expect(configuredIngestKeys(undefined, "test").size).toBe(0);
    expect(configuredIngestKeys(undefined, "production").size).toBe(0);
  });

  test("uses explicitly configured keys in production", () => {
    expect(
      configuredIngestKeys("vl_team_production-secret", "production").get(
        "team",
      ),
    ).toBe("vl_team_production-secret");
  });
});

describe("OTLP gateway authorization", () => {
  test("returns trusted project metadata without reading an OTLP body", async () => {
    const resolved: Array<{ teamId: string; project: string }> = [];
    const bindings: Array<{
      fingerprint: string;
      teamId: string;
      projectId: string;
    }> = [];
    const authorize = createOtlpAuthorizer({
      keys: new Map([["account1", "vl_account1_secret"]]),
      resolveProject: async (teamId, project) => {
        resolved.push({ teamId, project });
        return "00000000-0000-0000-0000-000000000123";
      },
      bindKey: async (fingerprint, teamId, projectId) => {
        bindings.push({ fingerprint, teamId, projectId });
        return true;
      },
    });

    const response = await createOtlpAuthApp(authorize).handle(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-versionless-team-id")).toBe("account1");
    expect(response.headers.get("x-versionless-project-id")).toBe(
      "00000000-0000-0000-0000-000000000123",
    );
    expect(resolved).toEqual([{ teamId: "account1", project: "billing-api" }]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      teamId: "account1",
      projectId: "00000000-0000-0000-0000-000000000123",
    });
    expect(bindings[0]!.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test("rejects missing projects, invalid secrets, and conflicting bindings", async () => {
    const authorize = createOtlpAuthorizer({
      keys: new Map([["account1", "vl_account1_secret"]]),
      verifyExternal: async () => null,
      resolveProject: async () =>
        "00000000-0000-0000-0000-000000000123",
      bindKey: async () => false,
    });
    const app = createOtlpAuthApp(authorize);

    expect((await app.handle(request("Bearer wrong"))).status).toBe(401);
    expect((await app.handle(request(undefined, ""))).status).toBe(401);
    expect((await app.handle(request())).status).toBe(401);
  });

  test("caches successful authorizations instead of re-hitting the database", async () => {
    let resolveCalls = 0;
    let bindCalls = 0;
    const authorize = createOtlpAuthorizer({
      keys: new Map([["account1", "vl_account1_secret"]]),
      resolveProject: async () => {
        resolveCalls += 1;
        return "00000000-0000-0000-0000-000000000123";
      },
      bindKey: async () => {
        bindCalls += 1;
        return true;
      },
    });

    try {
      setSystemTime(new Date("2026-07-24T12:00:00Z"));
      const first = await authorize("Bearer vl_account1_secret", "billing-api");
      const second = await authorize(
        "Bearer vl_account1_secret",
        "billing-api",
      );
      expect(first).toEqual({
        teamId: "account1",
        projectId: "00000000-0000-0000-0000-000000000123",
      });
      expect(second).toEqual(first);
      expect(resolveCalls).toBe(1);
      expect(bindCalls).toBe(1);

      // A different project on the same key is a distinct authorization.
      await authorize("Bearer vl_account1_secret", "checkout-api");
      expect(resolveCalls).toBe(2);

      // Entries expire, so a revoked binding stops working within the TTL.
      setSystemTime(new Date("2026-07-24T12:01:01Z"));
      await authorize("Bearer vl_account1_secret", "billing-api");
      expect(bindCalls).toBe(3);
    } finally {
      setSystemTime();
    }
  });

  test("never caches rejections", async () => {
    let bindCalls = 0;
    const authorize = createOtlpAuthorizer({
      keys: new Map([["account1", "vl_account1_secret"]]),
      resolveProject: async () => "00000000-0000-0000-0000-000000000123",
      bindKey: async () => {
        bindCalls += 1;
        return false;
      },
    });

    expect(await authorize("Bearer vl_account1_secret", "billing-api")).toBe(
      null,
    );
    expect(await authorize("Bearer vl_account1_secret", "billing-api")).toBe(
      null,
    );
    expect(bindCalls).toBe(2);
  });

  test("accepts externally verified Hexclave keys", async () => {
    const authorize = createOtlpAuthorizer({
      keys: new Map(),
      verifyExternal: async (key) =>
        key === "hexclave-secret" ? "team_hexclave" : null,
      resolveProject: async () =>
        "00000000-0000-0000-0000-000000000999",
      bindKey: async () => true,
    });

    const response = await createOtlpAuthApp(authorize).handle(
      request("Bearer hexclave-secret"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-versionless-team-id")).toBe(
      "team_hexclave",
    );
  });
});

describe("lastSeenAt refresh throttle", () => {
  test("only writes once the stored timestamp is stale", () => {
    const now = new Date("2026-07-24T12:00:00Z");
    expect(lastSeenNeedsRefresh(now, now)).toBe(false);
    expect(
      lastSeenNeedsRefresh(
        new Date(now.getTime() - LAST_SEEN_REFRESH_INTERVAL_MS),
        now,
      ),
    ).toBe(false);
    expect(
      lastSeenNeedsRefresh(
        new Date(now.getTime() - LAST_SEEN_REFRESH_INTERVAL_MS - 1),
        now,
      ),
    ).toBe(true);
  });
});
