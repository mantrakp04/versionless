import { describe, expect, test } from "bun:test";

import {
  localClickhouseUrl,
  localCorsOrigin,
  localDatabaseUrl,
} from "./local";

describe("server environment defaults", () => {
  async function loadEnvValue(
    key: "AI_BASE_URL" | "CORS_ORIGIN" | "DATABASE_URL" | "CLICKHOUSE_URL",
    options: {
      nodeEnv: "development" | "production";
      override?: Partial<
        Record<
          "AI_BASE_URL" | "CORS_ORIGIN" | "DATABASE_URL" | "CLICKHOUSE_URL",
          string
        >
      >;
    },
  ): Promise<string> {
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        `const { env } = await import("./src/server.ts"); process.stdout.write(String(env.${key} ?? ""));`,
      ],
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        NODE_ENV: options.nodeEnv,
        SKIP_ENV_VALIDATION: "1",
        // Clear inherited workspace values so defaults are exercised.
        AI_BASE_URL: "",
        CORS_ORIGIN: "",
        DATABASE_URL: "",
        CLICKHOUSE_URL: "",
        ...options.override,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout;
  }

  test("resolves AI defaults before skipped validation", async () => {
    expect(
      await loadEnvValue("AI_BASE_URL", { nodeEnv: "production" }),
    ).toBe("https://openrouter.ai/api/v1");
    expect(
      await loadEnvValue("AI_BASE_URL", { nodeEnv: "development" }),
    ).toBe("http://localhost:8317/v1");
  });

  test("preserves an explicit AI provider URL", async () => {
    expect(
      await loadEnvValue("AI_BASE_URL", {
        nodeEnv: "production",
        override: { AI_BASE_URL: "https://models.example/v1" },
      }),
    ).toBe("https://models.example/v1");
  });

  test("defaults local stack URLs in development", async () => {
    expect(
      await loadEnvValue("CORS_ORIGIN", { nodeEnv: "development" }),
    ).toBe(localCorsOrigin);
    expect(
      await loadEnvValue("DATABASE_URL", { nodeEnv: "development" }),
    ).toBe(localDatabaseUrl);
    expect(
      await loadEnvValue("CLICKHOUSE_URL", { nodeEnv: "development" }),
    ).toBe(localClickhouseUrl);
  });

  test("does not invent production stack URL defaults", async () => {
    expect(
      await loadEnvValue("CORS_ORIGIN", { nodeEnv: "production" }),
    ).toBe("");
    expect(
      await loadEnvValue("DATABASE_URL", { nodeEnv: "production" }),
    ).toBe("");
    expect(
      await loadEnvValue("CLICKHOUSE_URL", { nodeEnv: "production" }),
    ).toBe("");
  });
});
