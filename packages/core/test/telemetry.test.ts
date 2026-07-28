import { describe, expect, test } from "bun:test";
import {
  createVersionless,
  httpOtlpLogsSink,
  telemetryEventsToOtlp,
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

/** Log-record attributes of the first event, keyed for direct lookup. */
function attributesOf(
  request: ReturnType<typeof telemetryEventsToOtlp>,
): Record<string, unknown> {
  const record = request.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;
  return Object.fromEntries(
    (record.attributes ?? []).map(({ key, value }) => [key, value]),
  );
}

describe("named cloud projects", () => {
  test("exposes build upload settings from SDK initialization", () => {
    const instance = createVersionless({
      scheme: "date",
      current: "2026-07-21",
      resolve: [{ default: "current" }],
      project: "billing-api",
      apiKey: "vl_demo_secret",
      apiUrl: "https://versions.example.test",
      traces: false,
    });

    expect(instance._cloud).toEqual({
      project: "billing-api",
      apiKey: "vl_demo_secret",
      apiUrl: "https://versions.example.test",
    });
  });

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
    expect(headers[0]!.get("x-versionless-project")).toBe("billing-api");
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

test("marks failed request logs as errors", () => {
  const request = telemetryEventsToOtlp("billing-api", [
    event,
    {
      ...event,
      status: 409,
      errorBody: {
        code: "resource_conflict",
        message: "The resource was updated by another request.",
      },
    },
  ]);
  const records = request.resourceLogs[0]!.scopeLogs[0]!.logRecords;

  expect(records[0]).toMatchObject({
    severityNumber: 9,
    severityText: "INFO",
    body: { stringValue: "versionless request exchange" },
  });
  expect(records[1]).toMatchObject({
    severityNumber: 17,
    severityText: "ERROR",
    body: {
      stringValue:
        '{"code":"resource_conflict","message":"The resource was updated by another request."}',
    },
  });
});

test("uses a safe error body when a failed event has no explicit summary", () => {
  const request = telemetryEventsToOtlp("billing-api", [
    { ...event, status: 500 },
  ]);
  const record = request.resourceLogs[0]!.scopeLogs[0]!.logRecords[0];
  const body =
    record?.body && "stringValue" in record.body
      ? JSON.parse(record.body.stringValue)
      : undefined;

  expect(body).toEqual({
    code: "internal_error",
    message: "The request could not be completed.",
  });
});

test("records where a request's version came from", () => {
  const request = telemetryEventsToOtlp("billing-api", [
    { ...event, versionSource: "default" },
  ]);
  const attributes = attributesOf(request);

  expect(attributes["versionless.version.source"]).toEqual({
    stringValue: "default",
  });
  // Absent, not `false`. The rollup counts clamped requests with a map lookup,
  // and a map key that is always present would make "never clamped" and "not
  // recorded" indistinguishable at query time.
  expect(attributes).not.toHaveProperty("versionless.clamped");
  expect(attributes).not.toHaveProperty("versionless.version.requested");
});

test("flags a clamped request with the version its client asked for", () => {
  const request = telemetryEventsToOtlp("billing-api", [
    {
      ...event,
      versionSource: "header",
      requestedVersion: "2099-01-01",
      clamped: true,
    },
  ]);
  const attributes = attributesOf(request);

  expect(attributes["versionless.version.requested"]).toEqual({
    stringValue: "2099-01-01",
  });
  // The Collector stringifies every attribute into the `Map(String, String)`
  // `LogAttributes` column, and a bool renders as `true`/`false` — which is why
  // the rollup's predicate compares against the string `'true'`. If this ever
  // became `{ stringValue: "true" }` the rollup would keep working; if it became
  // an int it would silently count zero clamped requests forever.
  expect(attributes["versionless.clamped"]).toEqual({ boolValue: true });
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
