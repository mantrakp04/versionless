import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../src/errors";
import {
  readSnapshot,
  snapshotPath,
  surfaceHash,
  writeSnapshot,
} from "../src/snapshot/store";
import type { Surface } from "../src/surface/types";

function surface(version = "2026-07-21", extra?: Partial<Surface>): Surface {
  return {
    formatVersion: 1,
    version,
    tool: "@versionless/cli@test",
    models: {},
    endpoints: {
      "GET /users/:id": {
        transport: "http",
        method: "GET",
        path: "/users/:id",
        params: null,
        query: null,
        body: null,
        responses: { "200": { kind: "object", fields: { id: { type: { kind: "string" } } } } },
      },
    },
    ...extra,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "versionless-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("snapshot integrity", () => {
  test("writeSnapshot stamps an integrity hash that readSnapshot accepts", () => {
    const path = writeSnapshot(dir, surface());
    const loaded = readSnapshot(path);
    expect(loaded.integrity).toEqual({
      algo: "fnv1a-32",
      hash: surfaceHash(loaded),
    });
  });

  test("a hand-edited snapshot fails the integrity check with exit 4", () => {
    const path = writeSnapshot(dir, surface());
    const raw = JSON.parse(readFileSync(path, "utf8"));
    raw.endpoints["GET /users/:id"].responses["200"].fields.id.type.kind = "number";
    writeFileSync(path, JSON.stringify(raw));

    let err: CliError | null = null;
    try {
      readSnapshot(path);
    } catch (e) {
      err = e as CliError;
    }
    expect(err).toBeInstanceOf(CliError);
    expect(err!.exitCode).toBe(4);
    expect(err!.message).toContain("integrity");
  });

  test("pre-integrity snapshots (no integrity field) still load", () => {
    const path = snapshotPath(dir, "2026-07-21");
    const legacy = surface();
    writeFileSync(path, JSON.stringify(legacy));
    expect(readSnapshot(path).version).toBe("2026-07-21");
  });

  test("hash ignores integrity and provenance metadata", () => {
    const bare = surface();
    const stamped: Surface = {
      ...bare,
      integrity: { algo: "fnv1a-32", hash: "whatever" },
      provenance: { repo: "acme/api", sha: "abc123" },
    };
    expect(surfaceHash(stamped)).toBe(surfaceHash(bare));
  });
});

describe("snapshot overwrite protection", () => {
  test("re-writing identical content is idempotent", () => {
    writeSnapshot(dir, surface());
    expect(() => writeSnapshot(dir, surface())).not.toThrow();
  });

  test("different content for the same version is refused without overwrite", () => {
    writeSnapshot(dir, surface());
    const changed = surface();
    (changed.endpoints["GET /users/:id"] as { method: string }).method = "POST";

    let err: CliError | null = null;
    try {
      writeSnapshot(dir, changed);
    } catch (e) {
      err = e as CliError;
    }
    expect(err).toBeInstanceOf(CliError);
    expect(err!.exitCode).toBe(2);
    expect(err!.message).toContain("--overwrite");
  });

  test("overwrite: true replaces different content", () => {
    writeSnapshot(dir, surface());
    const changed = surface();
    (changed.endpoints["GET /users/:id"] as { method: string }).method = "POST";
    const path = writeSnapshot(dir, changed, { overwrite: true });
    expect((readSnapshot(path).endpoints["GET /users/:id"] as { method: string }).method).toBe("POST");
  });

  test("a corrupted existing snapshot is also protected", () => {
    const path = writeSnapshot(dir, surface());
    writeFileSync(path, "{ not json");
    expect(() => writeSnapshot(dir, surface())).toThrow(CliError);
    // ...but --overwrite recovers.
    expect(() => writeSnapshot(dir, surface(), { overwrite: true })).not.toThrow();
    expect(readSnapshot(path).version).toBe("2026-07-21");
  });
});

describe("provenance", () => {
  test("GitHub Actions env is recorded on write", () => {
    const prev = {
      repo: process.env["GITHUB_REPOSITORY"],
      ref: process.env["GITHUB_REF_NAME"],
      sha: process.env["GITHUB_SHA"],
    };
    process.env["GITHUB_REPOSITORY"] = "acme/api";
    process.env["GITHUB_REF_NAME"] = "main";
    process.env["GITHUB_SHA"] = "deadbeef";
    try {
      const path = writeSnapshot(dir, surface());
      expect(readSnapshot(path).provenance).toEqual({
        repo: "acme/api",
        ref: "main",
        sha: "deadbeef",
      });
    } finally {
      for (const [key, value] of [
        ["GITHUB_REPOSITORY", prev.repo],
        ["GITHUB_REF_NAME", prev.ref],
        ["GITHUB_SHA", prev.sha],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
