import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import {
  assertReadOnlyStatement,
  executeProjectPgQuery,
  MAX_RESULT_ROWS,
  PG_PROJECT_SETTING,
  PG_QUERY_ROLE,
  PG_READABLE_TABLES,
  PG_TEAM_SETTING,
  pgQueryAccessStatements,
  ProjectPgQueryError,
  provisionPgQueryAccess,
  type RestrictedPgQueryPool,
} from "./postgres-query";

interface Executed {
  text: string;
  values?: unknown[];
}

function recordingPool(rows: unknown[]): {
  pool: RestrictedPgQueryPool;
  executed: Executed[];
  released: () => number;
} {
  const executed: Executed[] = [];
  let releases = 0;
  return {
    executed,
    released: () => releases,
    pool: {
      async connect() {
        return {
          async query(text: string, values?: unknown[]) {
            executed.push({ text, values });
            return { rows: text.trim().startsWith("SELECT ") ? rows : [] };
          },
          release() {
            releases += 1;
          },
        };
      },
    },
  };
}

describe("restricted Postgres role provisioning", () => {
  const statements = pgQueryAccessStatements("a-sixteen-char-password");
  const sql = statements.join("\n");

  test("creates a login role that cannot bypass row level security", () => {
    expect(sql).toContain(`CREATE ROLE ${PG_QUERY_ROLE} LOGIN`);
    expect(sql).toContain("NOBYPASSRLS");
    expect(sql).toContain("NOSUPERUSER");
    expect(sql).toContain("NOCREATEROLE");
    // BYPASSRLS on this role would silently defeat every policy below.
    expect(sql).not.toMatch(/\bWITH BYPASSRLS\b/);
    expect(sql).not.toMatch(/(?<!NO)SUPERUSER/);
  });

  test("grants SELECT only, and only on the three readable tables", () => {
    const granted = statements
      .map((statement) => /^GRANT SELECT ON (\w+) TO /.exec(statement)?.[1])
      .filter((table): table is string => Boolean(table));

    expect(granted.sort()).toEqual([...PG_READABLE_TABLES].sort());
    // telemetry_ingest_keys is credential-adjacent and must stay unreadable.
    expect(granted).not.toContain("telemetry_ingest_keys");
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)/);
    // Stale grants from an earlier deploy are revoked before the new ones.
    const revokeIndex = statements.findIndex((statement) =>
      statement.startsWith("REVOKE ALL ON ALL TABLES"),
    );
    const firstGrantIndex = statements.findIndex((statement) =>
      statement.startsWith("GRANT SELECT ON "),
    );
    expect(revokeIndex).toBeGreaterThanOrEqual(0);
    expect(revokeIndex).toBeLessThan(firstGrantIndex);
  });

  test("enables but never forces RLS, so the owner connection is unaffected", () => {
    for (const table of PG_READABLE_TABLES) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
    // FORCE would apply the policies to the table owner too, which is the
    // app's own connection — every existing tRPC router would start reading
    // zero rows.
    expect(sql).not.toContain("FORCE ROW LEVEL SECURITY");
  });

  test("gives every readable table a fail-closed SELECT policy", () => {
    for (const table of PG_READABLE_TABLES) {
      const policy = statements.find((statement) =>
        statement.startsWith(`CREATE POLICY ${table}_versionless_project_isolation`),
      );
      expect(policy).toBeDefined();
      expect(policy).toContain(`FOR SELECT TO ${PG_QUERY_ROLE}`);
      // The `true` missing-ok form yields NULL when the GUC is unset, and a
      // NULL comparison is never true: an unscoped connection reads nothing.
      expect(policy).toContain(
        `current_setting('${PG_PROJECT_SETTING}', true)`,
      );
      // Dropped first so a predicate loosened by an earlier deploy is replaced
      // rather than left in place alongside the new one.
      expect(sql).toContain(
        `DROP POLICY IF EXISTS ${table}_versionless_project_isolation ON ${table}`,
      );
    }

    // `projects` is the only table with a team column, and it must use it:
    // a project id alone would otherwise be replayable across tenants.
    const projectsPolicy = statements.find((statement) =>
      statement.startsWith("CREATE POLICY projects_versionless_project_isolation"),
    )!;
    expect(projectsPolicy).toContain(`current_setting('${PG_TEAM_SETTING}', true)`);

    // project_id/id are indexed UUID columns. Casting those columns to text
    // makes the policies non-sargable and forces sequential scans.
    expect(sql).toContain(
      `NULLIF(current_setting('${PG_PROJECT_SETTING}', true), '')::uuid`,
    );
    expect(sql).not.toMatch(/\b(?:id|project_id)::text\b/);
  });

  test("escapes the role password instead of interpolating it raw", () => {
    const injected = pgQueryAccessStatements("pw' NOSUPERUSER --").join("\n");
    expect(injected).toContain("'pw'' NOSUPERUSER --'");
  });

  test("never reports the password when a role statement fails", async () => {
    const password = "a-sixteen-char-password";
    const error = await provisionPgQueryAccess(
      {
        async query(text: string) {
          if (text.includes("PASSWORD")) {
            throw Object.assign(new Error("driver failed"), {
              query: text,
            });
          }
          return undefined;
        },
      },
      password,
    ).then(
      () => new Error("expected provisioning to fail"),
      (caught: unknown) => caught as Error,
    );

    expect(error.message).not.toBe("expected provisioning to fail");
    expect(error.message).not.toContain(password);
    expect(error.message).not.toContain("PASSWORD");
    expect(error.cause).toBeUndefined();
    expect(inspect(error)).not.toContain(password);
  });
});

describe("read-only statement guard", () => {
  test("accepts SELECT and WITH in any casing", () => {
    expect(() => assertReadOnlyStatement("select 1")).not.toThrow();
    expect(() =>
      assertReadOnlyStatement("  WITH t AS (SELECT 1) SELECT * FROM t"),
    ).not.toThrow();
    expect(() => assertReadOnlyStatement("SELECT 1;")).not.toThrow();
  });

  test("rejects writes and chained statements", () => {
    for (const query of [
      "UPDATE projects SET name = 'x'",
      "DELETE FROM projects",
      "INSERT INTO projects (name) VALUES ('x')",
      "DROP TABLE projects",
      "SET ROLE postgres",
    ]) {
      expect(() => assertReadOnlyStatement(query)).toThrow(ProjectPgQueryError);
    }
    expect(() =>
      assertReadOnlyStatement("SELECT 1; DROP TABLE projects"),
    ).toThrow("single statement");
  });
});

describe("executeProjectPgQuery", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";

  test("scopes the transaction to the trusted project and team", async () => {
    const { pool, executed, released } = recordingPool([{ total: 1 }]);

    const response = await executeProjectPgQuery(
      {
        projectId,
        teamId: "team_1",
        query: "SELECT count(*) AS total FROM projects",
        timeoutMs: 120_000,
      },
      { ensureAccess: async () => {}, pool },
    );

    expect(response.result).toEqual([{ total: 1 }]);
    expect(response.queryId).toStartWith(`${projectId}:`);

    const texts = executed.map((entry) => entry.text);
    expect(texts[0]).toBe("BEGIN TRANSACTION READ ONLY");
    // Clamped to MAX_QUERY_TIMEOUT_MS rather than honoring the 120s request.
    expect(texts[1]).toContain("set_config('statement_timeout', $1, true)");
    expect(executed[1]?.values).toEqual([
      "60000ms",
      PG_PROJECT_SETTING,
      projectId,
      PG_TEAM_SETTING,
      "team_1",
    ]);

    const configured = executed.filter((entry) =>
      entry.text.includes("set_config"),
    );
    expect(configured).toHaveLength(1);
    // Transaction-local (`true`), so the GUCs cannot survive onto the next
    // borrower of this pooled connection.
    expect(configured[0]?.text.match(/true\)/g)).toHaveLength(3);

    expect(texts).toContain("ROLLBACK");
    expect(released()).toBe(1);
  });

  test("passes positional params through and truncates oversized results", async () => {
    const rows = Array.from({ length: MAX_RESULT_ROWS + 5 }, (_, index) => ({
      index,
    }));
    const { pool, executed } = recordingPool(rows);

    const response = await executeProjectPgQuery(
      {
        projectId,
        teamId: "team_1",
        query: "SELECT * FROM project_versions WHERE version = $1",
        params: ["2026-07-24"],
      },
      { ensureAccess: async () => {}, pool },
    );

    expect(response.result).toHaveLength(MAX_RESULT_ROWS);
    const user = executed.find((entry) =>
      entry.text.includes("project_versions"),
    );
    expect(user?.values).toEqual(["2026-07-24"]);
    expect(user?.text).toStartWith("SELECT *\nFROM (");
    expect(user?.text).toContain(`LIMIT ${MAX_RESULT_ROWS}`);
  });

  test("rejects a write before opening a transaction", async () => {
    const { pool, executed } = recordingPool([]);

    await expect(
      executeProjectPgQuery(
        { projectId, teamId: "team_1", query: "DELETE FROM projects" },
        { ensureAccess: async () => {}, pool },
      ),
    ).rejects.toThrow(ProjectPgQueryError);

    expect(executed).toHaveLength(0);
  });

  test("scrubs driver errors and still rolls back and releases", async () => {
    let releases = 0;
    const texts: string[] = [];
    const pool: RestrictedPgQueryPool = {
      async connect() {
        return {
          async query(text: string) {
            texts.push(text);
            if (text.includes("FROM projects")) {
              throw Object.assign(
                new Error('column "secret_column" does not exist'),
                { code: "42703" },
              );
            }
            return { rows: [] };
          },
          release() {
            releases += 1;
          },
        };
      },
    };

    const error = await executeProjectPgQuery(
      { projectId, teamId: "team_1", query: "SELECT secret_column FROM projects" },
      { ensureAccess: async () => {}, pool, isDevelopment: false },
    ).then(
      () => new Error("expected the query to fail"),
      (caught: unknown) => caught as Error,
    );

    // 42703 is not allowlisted: the column name would be schema reconnaissance.
    expect(error.message).toBe("Error during execution of this query.");
    expect(error.message).not.toContain("secret_column");
    expect(texts).toContain("ROLLBACK");
    expect(releases).toBe(1);
  });
});
