import { describe, expect, test } from "bun:test";
import { safeClickHouseError } from "./clickhouse-errors";

describe("raw query error disclosure", () => {
  test("keeps syntax diagnostics but hides restricted-schema errors", () => {
    expect(
      safeClickHouseError(
        { code: "62", message: "Syntax error near SELECT" },
        false,
      ),
    ).toContain("Syntax error");

    const production = safeClickHouseError(
      {
        code: "47",
        message: "Unknown identifier. Maybe you meant private_email",
      },
      false,
    );
    expect(production).toBe("Error during execution of this query.");
    expect(production).not.toContain("private_email");
  });

  test("defaults to scrubbing outside development (NODE_ENV=test here)", () => {
    // The default flag comes from the shared isDevelopment predicate, so a
    // test or unschemed environment behaves like production.
    const scrubbed = safeClickHouseError({
      code: "47",
      message: "Unknown identifier. Maybe you meant private_email",
    });
    expect(scrubbed).toBe("Error during execution of this query.");
    expect(scrubbed).not.toContain("private_email");
  });
});

