import { describe, expect, test } from "bun:test";
import { safePostgresError } from "./postgres-errors";

describe("Postgres query error disclosure", () => {
  test("keeps operational diagnostics but hides schema errors", () => {
    expect(
      safePostgresError(
        { code: "42601", message: 'syntax error at or near "FRM"' },
        false,
      ),
    ).toContain("syntax error");
    expect(
      safePostgresError(
        { code: "57014", message: "canceling statement due to statement timeout" },
        false,
      ),
    ).toContain("statement timeout");

    const production = safePostgresError(
      {
        code: "42703",
        message: 'column "hashed_secret" does not exist',
      },
      false,
    );
    expect(production).toBe("Error during execution of this query.");
    expect(production).not.toContain("hashed_secret");
  });

  test("carries the friendly copy and the diagnostic in development", () => {
    const development = safePostgresError(
      { code: "42P01", message: 'relation "telemetry_ingest_keys" does not exist' },
      true,
    );
    expect(development).toContain("Error during execution of this query.");
    expect(development).toContain("Postgres 42P01");
    expect(development).toContain("telemetry_ingest_keys");
  });

  test("defaults to scrubbing outside development (NODE_ENV=test here)", () => {
    const scrubbed = safePostgresError({
      code: "42501",
      message: "permission denied for table telemetry_ingest_keys",
    });
    expect(scrubbed).toBe("Error during execution of this query.");
    expect(scrubbed).not.toContain("telemetry_ingest_keys");
  });

  test("scrubs anything that is not a recognizable driver error", () => {
    expect(safePostgresError(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(
      "Error during execution of this query.",
    );
    expect(safePostgresError("boom")).toBe(
      "Error during execution of this query.",
    );
  });
});
