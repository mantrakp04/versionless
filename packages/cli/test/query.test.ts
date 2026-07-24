import { describe, expect, test } from "bun:test";
import { runQuery, type QueryCommandDependencies } from "../src/commands/query";
import { CliError } from "../src/errors";

function dependencies(
  fetchImpl: QueryCommandDependencies["fetch"],
  output: string[],
): QueryCommandDependencies {
  return {
    getAccessToken: async () => "access-token",
    fetch: fetchImpl,
    write: (value) => output.push(value),
    readStdin: async () => "",
  };
}

describe("versionless query", () => {
  test("sends authenticated raw SQL and renders JSON lines", async () => {
    const output: string[] = [];
    let request: Request | undefined;
    const fetchImpl: QueryCommandDependencies["fetch"] = async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        result: [{ event: "versionless.request", total: 42 }],
        query_id: "query_1",
      });
    };

    const code = await runQuery(
      [
        "--project",
        "11111111-1111-4111-8111-111111111111",
        "--project-id",
        "hexclave-project",
        "--server-url",
        "https://api.versionless.test/",
        "--params",
        '{"event":"versionless.request"}',
        "SELECT count() AS total FROM otel_logs WHERE EventName = {event:String}",
      ],
      "/tmp",
      dependencies(fetchImpl, output),
    );

    expect(code).toBe(0);
    expect(request?.url).toBe("https://api.versionless.test/v1/query");
    expect(request?.headers.get("authorization")).toBe("Bearer access-token");
    expect(await request?.json()).toEqual({
      projectId: "11111111-1111-4111-8111-111111111111",
      query:
        "SELECT count() AS total FROM otel_logs WHERE EventName = {event:String}",
      params: { event: "versionless.request" },
      timeoutMs: 10_000,
    });
    expect(output.join("")).toBe(
      '{"event":"versionless.request","total":42}\n',
    );
  });

  test("rejects a query when no telemetry project is selected", async () => {
    const error = await runQuery(
      ["--project-id", "hexclave-project", "--sql", "SELECT 1"],
      "/tmp",
      dependencies(fetch, []),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(2);
    expect((error as CliError).message).toContain("--project");
  });
});
