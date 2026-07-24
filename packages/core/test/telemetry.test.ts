import { describe, expect, test } from "bun:test";
import {
  createVersionless,
  httpOtlpLogsSink,
  TelemetryHub,
} from "../src/index";
import type { TelemetryEvent } from "../src/types";

const event: TelemetryEvent = {
  ts: 1_750_000_000_000,
  method: "GET",
  route: "GET /users",
  adapter: "test",
  version: "2026-07-21",
  latencyMs: 4,
  transformCount: 0,
  status: 200,
};

describe("named cloud projects", () => {
  test("requires a project name when an API key enables cloud telemetry", () => {
    expect(() =>
      createVersionless({
        scheme: "date",
        current: "2026-07-21",
        resolve: [{ default: "current" }],
        apiKey: "vl_demo_secret",
      }),
    ).toThrow("`project` is required");
  });

  test("includes the project name in every ingest batch", async () => {
    const bodies: unknown[] = [];
    const headers: Headers[] = [];
    const sink = httpOtlpLogsSink({
      url: "https://ingest.example.test/v1/logs",
      apiKey: "vl_demo_secret",
      project: "billing-api",
      immediate: true,
      fetchImpl: (async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        headers.push(new Headers(init?.headers));
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });

    sink.record(event);
    await sink.flush?.();

    expect(bodies[0]).toMatchObject({
      resourceLogs: [
        {
          resource: {
            attributes: expect.arrayContaining([
              {
                key: "service.name",
                value: { stringValue: "billing-api" },
              },
            ]),
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  eventName: "versionless.request",
                  timeUnixNano: "1750000000000000000",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(headers[0]!.get("x-versionless-project")).toBe(
      "billing-api",
    );
  });

  test("reports the first failed export in serverless mode", async () => {
    const errors: unknown[] = [];
    const sink = httpOtlpLogsSink({
      url: "https://ingest.example.test/v1/logs",
      apiKey: "vl_demo_secret",
      project: "billing-api",
      immediate: true,
      onError: (error) => errors.push(error),
      fetchImpl: (async () =>
        new Response(null, { status: 401 })) as unknown as typeof fetch,
    });

    sink.record(event);
    await sink.flush?.();

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("ingest responded 401");
  });
});

test("flushes and closes non-log telemetry lifecycles", async () => {
  const calls: string[] = [];
  const hub = new TelemetryHub();
  hub.useLifecycle({
    flush: async () => {
      calls.push("flush");
    },
    close: async () => {
      calls.push("close");
    },
  });

  await hub.flush();
  await hub.close();

  expect(calls).toEqual(["flush", "close"]);
});
