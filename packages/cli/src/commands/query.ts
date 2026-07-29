import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getQuery,
  searchQueries,
  type QueryDefinition,
} from "@versionless/query-catalog";
import { CliError } from "../errors";
import {
  getAccessToken,
  resolveHexclaveSettings,
  type HexclaveSettings,
} from "../auth/hexclave";
import { AUTH_OPTIONS } from "./login";
import { GLOBAL_OPTIONS, parseFlags, str } from "./shared";

const DEFAULT_SERVER_URL = "https://api.versionless.dev";

const HELP = `versionless query — search the catalog or run project-scoped ClickHouse SQL

Usage:
  versionless query search [terms] [--json]
  versionless query get <name> [--json]
  versionless query --project <id> --sql "SELECT ..."
  versionless query --project <id> --file query.sql
  versionless query --project <id> "SELECT ..."

The SQL executes as a read-only ClickHouse user. Database row policies scope
every otel_logs and otel_traces scan to the authenticated project.

Options:
  --project <id>      Versionless telemetry project UUID
  --sql <query>       SQL text (alternatively pass it as a positional argument)
  --file <path>       Read SQL from a file; use - for stdin
  --params <json>     ClickHouse query parameters as a JSON object
  --timeout <ms>      Execution timeout, 1000–60000 (default: 10000)
  --server-url <url>  Versionless API (default: $VERSIONLESS_SERVER_URL or
                      https://api.versionless.dev)
  --project-id <id>   Hexclave application project used by \`versionless login\`
  --api-url <url>     Hexclave API base
  --client-key <key>  Hexclave publishable client key, if required
  --json              Print the full response envelope instead of JSON lines
  -h, --help          Show this help
`;

type QueryValue = string | number | boolean | null;

export interface QueryCommandDependencies {
  getAccessToken(settings: HexclaveSettings): Promise<string>;
  fetch(input: string, init: RequestInit): Promise<Response>;
  write(output: string): void;
  readStdin(): Promise<string>;
}

const defaultDependencies: QueryCommandDependencies = {
  getAccessToken,
  fetch,
  write: (output) => process.stdout.write(output),
  readStdin: () => Bun.stdin.text(),
};

function writeCatalogResult(
  definition: QueryDefinition,
  json: boolean,
  write: (output: string) => void,
): void {
  write(
    json
      ? `${JSON.stringify(definition, null, 2)}\n`
      : `${definition.name}\n${definition.description}\n\n${definition.query}\n`,
  );
}

function parseParams(raw: string | undefined): Record<string, QueryValue> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("--params must be a JSON object", 2);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError("--params must be a JSON object", 2);
  }
  const entries = Object.entries(parsed);
  if (
    entries.some(
      ([, value]) =>
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean",
    )
  ) {
    throw new CliError(
      "--params values must be strings, numbers, booleans, or null",
      2,
    );
  }
  return Object.fromEntries(entries) as Record<string, QueryValue>;
}

function parseTimeout(raw: string | undefined): number {
  if (!raw) return 10_000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
    throw new CliError("--timeout must be an integer from 1000 to 60000", 2);
  }
  return value;
}

async function resolveSql(
  cwd: string,
  sqlFlag: string | undefined,
  file: string | undefined,
  positionals: string[],
  readStdin: () => Promise<string>,
): Promise<string> {
  const positional = positionals.join(" ").trim();
  const selected = [
    sqlFlag ? "sql" : null,
    file ? "file" : null,
    positional ? "positional" : null,
  ].filter(Boolean);
  if (selected.length !== 1) {
    throw new CliError(
      "Provide exactly one SQL source: --sql, --file, or a positional query",
      2,
    );
  }
  const sql =
    sqlFlag ??
    (file === "-"
      ? await readStdin()
      : file
        ? readFileSync(resolve(cwd, file), "utf8")
        : positional);
  if (!sql.trim()) throw new CliError("SQL query cannot be empty", 2);
  return sql;
}

export async function runQuery(
  argv: string[],
  cwd = process.cwd(),
  dependencies: QueryCommandDependencies = defaultDependencies,
): Promise<number> {
  const { values, positionals } = parseFlags(
    argv,
    {
      ...GLOBAL_OPTIONS,
      ...AUTH_OPTIONS,
      project: { type: "string" },
      sql: { type: "string" },
      file: { type: "string" },
      params: { type: "string" },
      timeout: { type: "string" },
      "server-url": { type: "string" },
    },
    true,
  );
  if (values["help"] === true) {
    dependencies.write(HELP);
    return 0;
  }

  const catalogCommand = positionals[0]?.toLowerCase();
  if (catalogCommand === "search") {
    const matches = searchQueries(positionals.slice(1).join(" "));
    if (values["json"] === true) {
      dependencies.write(`${JSON.stringify(matches, null, 2)}\n`);
    } else {
      for (const match of matches) {
        dependencies.write(`${match.name}\t${match.description}\n`);
      }
    }
    return 0;
  }
  if (catalogCommand === "get") {
    const name = positionals[1];
    if (!name || positionals.length !== 2) {
      throw new CliError("Usage: versionless query get <name>", 2);
    }
    const definition = getQuery(name);
    if (!definition) {
      throw new CliError(
        `Unknown query "${name}". Run \`versionless query search\` to list queries.`,
        2,
      );
    }
    writeCatalogResult(
      definition,
      values["json"] === true,
      dependencies.write,
    );
    return 0;
  }

  const projectId = str(values["project"]);
  if (!projectId) {
    throw new CliError("A telemetry project UUID is required: pass --project", 2);
  }
  const sql = await resolveSql(
    cwd,
    str(values["sql"]),
    str(values["file"]),
    positionals,
    dependencies.readStdin,
  );
  const settings = resolveHexclaveSettings({
    projectId: str(values["project-id"]),
    apiUrl: str(values["api-url"]),
    appUrl: str(values["app-url"]),
    clientKey: str(values["client-key"]),
  });
  const accessToken = await dependencies.getAccessToken(settings);
  const serverUrl = (
    str(values["server-url"]) ??
    process.env.VERSIONLESS_SERVER_URL ??
    DEFAULT_SERVER_URL
  ).replace(/\/+$/, "");

  let response: Response;
  try {
    response = await dependencies.fetch(`${serverUrl}/v1/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        query: sql,
        params: parseParams(str(values["params"])),
        timeoutMs: parseTimeout(str(values["timeout"])),
      }),
    });
  } catch (error) {
    throw new CliError(
      `Could not reach Versionless at ${serverUrl}: ${error instanceof Error ? error.message : String(error)}`,
      6,
    );
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : text.slice(0, 500) || `HTTP ${response.status}`;
    throw new CliError(
      message,
      response.status === 401 || response.status === 403 ? 5 : 6,
    );
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("result" in body) ||
    !Array.isArray(body.result)
  ) {
    throw new CliError("Versionless returned an invalid query response", 6);
  }

  if (values["json"] === true) {
    dependencies.write(`${JSON.stringify(body, null, 2)}\n`);
  } else {
    for (const row of body.result) {
      dependencies.write(`${JSON.stringify(row)}\n`);
    }
  }
  return 0;
}
