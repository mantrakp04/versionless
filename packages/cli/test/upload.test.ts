import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_CLOUD_API_URL,
  developmentApiUrl,
  resolveSnapshotApiUrl,
  uploadSnapshot,
} from "../src/snapshot/upload";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("snapshot upload", () => {
  test("uses the SDK URL before environment overrides", () => {
    expect(
      resolveSnapshotApiUrl({
        apiUrl: "https://sdk.example.test/",
        env: {
          VERSIONLESS_API_URL: "https://env.example.test",
          NODE_ENV: "production",
        },
      }),
    ).toBe("https://sdk.example.test");
  });

  test("defaults development uploads to the local API", () => {
    expect(resolveSnapshotApiUrl({ env: { NODE_ENV: "development" } })).toBe(
      "http://localhost:3000",
    );
    expect(resolveSnapshotApiUrl({ env: {} })).toBe("http://localhost:3000");
  });

  test("follows the checkout's PORT_PREFIX block in development", () => {
    expect(developmentApiUrl({ PORT_PREFIX: "31" })).toBe(
      "http://localhost:3100",
    );
    expect(
      resolveSnapshotApiUrl({ env: { PORT_PREFIX: "42" } }),
    ).toBe("http://localhost:4200");
    // A malformed prefix falls back rather than building an invalid port.
    expect(developmentApiUrl({ PORT_PREFIX: "3" })).toBe(
      "http://localhost:3000",
    );
  });

  test("defaults production uploads to the hosted API", () => {
    expect(resolveSnapshotApiUrl({ env: { NODE_ENV: "production" } })).toBe(
      DEFAULT_CLOUD_API_URL,
    );
  });

  test("supports the API URL environment override", () => {
    expect(
      resolveSnapshotApiUrl({
        env: {
          VERSIONLESS_API_URL: "http://versionless.internal:4000/",
          NODE_ENV: "development",
        },
      }),
    ).toBe("http://versionless.internal:4000");
  });

  test("sends the exact generated artifact with build-key authentication", async () => {
    const dir = mkdtempSync(join(tmpdir(), "versionless-upload-"));
    dirs.push(dir);
    const path = join(dir, "2026-07-24.json");
    const artifact = '{"formatVersion":1,"version":"2026-07-24"}\n';
    writeFileSync(path, artifact);
    let request: Request | undefined;

    const result = await uploadSnapshot({
      apiKey: "vl_team_secret",
      project: "billing-api",
      path,
      serverUrl: "https://api.versionless.test/",
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json({
          projectId: "11111111-1111-4111-8111-111111111111",
          version: "2026-07-24",
          created: true,
        });
      },
    });

    expect(request?.url).toBe("https://api.versionless.test/v1/versions");
    expect(request?.headers.get("authorization")).toBe(
      "Bearer vl_team_secret",
    );
    expect(request?.headers.get("x-versionless-project")).toBe("billing-api");
    expect(await request?.text()).toBe(artifact);
    expect(result).toEqual({
      projectId: "11111111-1111-4111-8111-111111111111",
      version: "2026-07-24",
      created: true,
    });
  });

  test("returns only the server's public error message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "versionless-upload-"));
    dirs.push(dir);
    const path = join(dir, "snapshot.json");
    writeFileSync(path, "{}");

    await expect(
      uploadSnapshot({
        apiKey: "bad",
        project: "billing-api",
        path,
        fetch: async () =>
          Response.json(
            { error: "The API key cannot upload this version." },
            { status: 401 },
          ),
      }),
    ).rejects.toThrow("The API key cannot upload this version.");
  });
});
