import { describe, expect, test } from "bun:test";

describe("server AI environment", () => {
  async function loadAiBaseUrl(
    nodeEnv: "development" | "production",
    override = "",
  ): Promise<string> {
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        'const { env } = await import("./src/server.ts"); process.stdout.write(env.AI_BASE_URL);',
      ],
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        NODE_ENV: nodeEnv,
        SKIP_ENV_VALIDATION: "1",
        AI_BASE_URL: override,
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

  test("resolves dynamic defaults before skipped validation", async () => {
    expect(await loadAiBaseUrl("production")).toBe(
      "https://openrouter.ai/api/v1",
    );
    expect(await loadAiBaseUrl("development")).toBe(
      "http://localhost:8317/v1",
    );
  });

  test("preserves an explicit provider URL", async () => {
    expect(
      await loadAiBaseUrl("production", "https://models.example/v1"),
    ).toBe("https://models.example/v1");
  });
});
