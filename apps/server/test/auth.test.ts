/**
 * Auth boundaries, exercised in-process with no Hexclave and no ClickHouse
 * configured (SKIP_ENV_VALIDATION): everything must fail closed — insights
 * require a session, OTLP ingest requires a valid key — while the versioned
 * public API stays public.
 */
import { describe, expect, test } from "bun:test";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.CORS_ORIGIN ??= "http://localhost:3001";

const { app } = await import("../src/app");
const base = "http://localhost";

describe("dashboard auth boundaries", () => {
  test("dashboard procedures reject unauthenticated callers", async () => {
    const input = encodeURIComponent(JSON.stringify({ teamId: "t_1" }));
    const res = await app.handle(
      new Request(`${base}/trpc/projects.list?input=${input}`),
    );
    const body = (await res.json()) as {
      error?: { data?: { code?: string; httpStatus?: number } };
    };
    expect(body.error?.data?.code).toBe("UNAUTHORIZED");
  });

  test("the Collector auth boundary rejects unknown bearer keys", async () => {
    const res = await app.handle(
      new Request(`${base}/internal/otlp/auth/v1/logs`, {
        headers: {
          authorization: "Bearer definitely-not-a-key",
          "x-versionless-project": "billing-api",
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("the public health surface needs no session", async () => {
    const root = await app.handle(new Request(`${base}/`));
    expect(root.status).toBe(200);

    const health = await app.handle(new Request(`${base}/trpc/healthCheck`));
    expect(health.status).toBe(200);
    const body = (await health.json()) as { result: { data: string } };
    expect(body.result.data).toBe("OK");
  });
});
