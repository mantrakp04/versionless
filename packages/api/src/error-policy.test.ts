import { describe, expect, test } from "bun:test";
import { TRPCError, type TRPCDefaultErrorShape } from "@trpc/server";

import { applyPublicErrorPolicy, publicQueryHttpError } from "./error-policy";
import {
  ProjectQueryError,
  ProjectQueryUnavailableError,
} from "./lib/clickhouse-query";
import { isDevelopment } from "./lib/env-mode";
import {
  ProjectPgQueryError,
  ProjectPgQueryUnavailableError,
} from "./lib/postgres-query";

const internalShape: TRPCDefaultErrorShape = {
  code: -32603,
  message:
    "ClickHouse failed at http://admin:secret@db.internal:8123/telemetry",
  data: {
    code: "INTERNAL_SERVER_ERROR",
    httpStatus: 500,
    path: "insights.adoption",
    stack: "Error: secret stack trace",
  },
};

describe("tRPC public error policy", () => {
  test("removes diagnostics from production response payloads", () => {
    const result = applyPublicErrorPolicy(internalShape, false);

    expect(result.message).toBe("Something went wrong. Please try again.");
    expect(result.data.path).toBeUndefined();
    expect(result.data.stack).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.data.code).toBe("INTERNAL_SERVER_ERROR");
  });

  test("retains actual diagnostics in development", () => {
    expect(applyPublicErrorPolicy(internalShape, true)).toEqual(internalShape);
  });
});

describe("shared development predicate", () => {
  test("treats the test environment like production", () => {
    // bun test runs with NODE_ENV=test; only an explicit "development"
    // opts into diagnostics, so scrubbing is the default everywhere else.
    expect(isDevelopment).toBe(false);
  });
});

describe("HTTP query boundary error policy", () => {
  test("maps access errors onto policy copy in production", () => {
    const forbidden = publicQueryHttpError(
      new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have access to project p_secret_internal",
      }),
      false,
    );
    expect(forbidden).toEqual({
      status: 403,
      message: "You do not have access to this resource.",
    });

    const notFound = publicQueryHttpError(
      new TRPCError({ code: "NOT_FOUND", message: "Project not found" }),
      false,
    );
    expect(notFound.status).toBe(404);
    expect(notFound.message).toBe(
      "The requested resource could not be found.",
    );
  });

  test("hides infrastructure diagnostics in production but keeps them in development", () => {
    const unavailable = new ProjectQueryUnavailableError(
      "ClickHouse unavailable — set CLICKHOUSE_URL and run `bun start-deps`",
    );
    const production = publicQueryHttpError(unavailable, false);
    expect(production.status).toBe(503);
    expect(production.message).not.toContain("CLICKHOUSE_URL");
    expect(production.message).toBe(
      "This service is temporarily unavailable. Please try again shortly.",
    );

    expect(publicQueryHttpError(unavailable, true)).toEqual({
      status: 503,
      message: unavailable.message,
    });
  });

  test("passes already-scrubbed query errors through in both modes", () => {
    const queryError = new ProjectQueryError("Syntax error near SELECT");
    expect(publicQueryHttpError(queryError, false)).toEqual({
      status: 400,
      message: "Syntax error near SELECT",
    });
    expect(publicQueryHttpError(queryError, true)).toEqual({
      status: 400,
      message: "Syntax error near SELECT",
    });
  });

  test("applies the same policy to the Postgres query plane", () => {
    const unavailable = new ProjectPgQueryUnavailableError(
      'relation "telemetry_ingest_keys" does not exist',
    );
    const production = publicQueryHttpError(unavailable, false);
    expect(production.status).toBe(503);
    expect(production.message).not.toContain("telemetry_ingest_keys");
    expect(production.message).toBe(
      "This service is temporarily unavailable. Please try again shortly.",
    );
    expect(publicQueryHttpError(unavailable, true)).toEqual({
      status: 503,
      message: unavailable.message,
    });

    // safePostgresError already decided what this string may contain, so it
    // passes through unchanged in both modes — same contract as ClickHouse.
    const queryError = new ProjectPgQueryError(
      "Only SELECT and WITH queries are allowed on this endpoint.",
    );
    for (const development of [false, true]) {
      expect(publicQueryHttpError(queryError, development)).toEqual({
        status: 400,
        message: "Only SELECT and WITH queries are allowed on this endpoint.",
      });
    }
  });

  test("scrubs unknown errors in production", () => {
    const unknown = new Error(
      "connect ECONNREFUSED admin:secret@db.internal:8123",
    );
    const production = publicQueryHttpError(unknown, false);
    expect(production.status).toBe(503);
    expect(production.message).not.toContain("db.internal");

    expect(publicQueryHttpError(unknown, true).message).toBe(unknown.message);
  });
});
