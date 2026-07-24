import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  credentialKey,
  credentialsPath,
  deleteCredential,
  readCredential,
  writeCredential,
} from "../src/auth/credentials";
import {
  initiateCliAuth,
  pollCliAuth,
  refreshAccessToken,
  resolveHexclaveSettings,
} from "../src/auth/hexclave";
import { runLogout } from "../src/commands/logout";
import { runWhoami } from "../src/commands/whoami";
import { CliError } from "../src/errors";

/**
 * Live tests talk to the real Hexclave API using the same project the seed
 * script uses, resolved from the environment or apps/server/.env. Without a
 * project id (e.g. a bare CI checkout) they skip. Only the unauthenticated
 * half of the flow is exercised — completing a login needs a browser.
 */
function realProjectId(): string | undefined {
  const fromEnv = process.env.HEXCLAVE_PROJECT_ID;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  const envPath = join(import.meta.dir, "../../../apps/server/.env");
  if (!existsSync(envPath)) return undefined;
  const match = readFileSync(envPath, "utf8").match(/^HEXCLAVE_PROJECT_ID=(.+)$/m);
  const value = match?.[1]?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
}
const PROJECT_ID = realProjectId();

const ENV_KEYS = [
  "VERSIONLESS_CONFIG_DIR",
  "HEXCLAVE_PROJECT_ID",
  "HEXCLAVE_API_URL",
  "HEXCLAVE_APP_URL",
  "HEXCLAVE_PUBLISHABLE_CLIENT_KEY",
] as const;

let dir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "versionless-auth-"));
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.VERSIONLESS_CONFIG_DIR = dir;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("credentials store", () => {
  test("write/read/delete roundtrip with 0600 perms", () => {
    const key = credentialKey("https://api.hexclave.com", "proj_test");
    expect(readCredential(key)).toBeNull();

    writeCredential(key, { refreshToken: "rt_1", savedAt: "2026-07-23T00:00:00Z" });
    expect(readCredential(key)?.refreshToken).toBe("rt_1");
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);

    expect(deleteCredential(key)).toBe(true);
    expect(deleteCredential(key)).toBe(false);
    expect(existsSync(credentialsPath())).toBe(false);
  });
});

describe("resolveHexclaveSettings", () => {
  test("requires a project id", () => {
    try {
      resolveHexclaveSettings({});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(2);
    }
  });

  test("derives the hosted app URL and reads env fallbacks", () => {
    process.env.HEXCLAVE_PROJECT_ID = "proj_env";
    const settings = resolveHexclaveSettings({});
    expect(settings.projectId).toBe("proj_env");
    expect(settings.apiUrl).toBe("https://api.hexclave.com");
    expect(settings.appUrl).toBe("https://proj_env.built-with-stack-auth.com");
  });
});

describe("versionless whoami", () => {
  test("fails with exit 5 when not logged in, before any network call", async () => {
    const err = await runWhoami(["--project-id", "proj_test"]).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(5);
    expect((err as CliError).message).toContain("versionless login");
  });
});

describe("versionless logout", () => {
  test("removes only the resolved project's credential", async () => {
    const keep = credentialKey("https://api.hexclave.com", "proj_other");
    writeCredential(keep, { refreshToken: "rt_keep", savedAt: "2026-07-23T00:00:00Z" });
    writeCredential(credentialKey("https://api.hexclave.com", "proj_test"), {
      refreshToken: "rt_1",
      savedAt: "2026-07-23T00:00:00Z",
    });

    const code = await runLogout(["--project-id", "proj_test"]);
    expect(code).toBe(0);
    expect(
      readCredential(credentialKey("https://api.hexclave.com", "proj_test")),
    ).toBeNull();
    expect(readCredential(keep)?.refreshToken).toBe("rt_keep");

    // Logging out twice is a no-op, still exit 0.
    expect(await runLogout(["--project-id", "proj_test"])).toBe(0);
  });
});

describe.skipIf(PROJECT_ID === undefined)("live Hexclave", () => {
  const settings = () => resolveHexclaveSettings({ projectId: PROJECT_ID });

  test(
    "initiates a CLI login and polls waiting",
    async () => {
      const initiation = await initiateCliAuth(settings(), 120_000);
      expect(initiation.pollingCode.length).toBeGreaterThan(0);
      expect(initiation.loginCode.length).toBeGreaterThan(0);
      expect(initiation.loginUrl).toBe(
        `https://${PROJECT_ID}.built-with-stack-auth.com/handler/cli-auth-confirm?login_code=${encodeURIComponent(initiation.loginCode)}`,
      );
      expect(await pollCliAuth(settings(), initiation.pollingCode)).toEqual({
        status: "waiting",
      });
    },
    15_000,
  );

  test(
    "rejects an invalid refresh token with exit 5",
    async () => {
      const err = await refreshAccessToken(settings(), "rt_invalid").catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(5);
      expect((err as CliError).message).toContain("401");
    },
    15_000,
  );

  test(
    "whoami with a revoked stored token exits 5",
    async () => {
      writeCredential(
        credentialKey("https://api.hexclave.com", PROJECT_ID as string),
        { refreshToken: "rt_revoked", savedAt: "2026-07-23T00:00:00Z" },
      );
      const err = await runWhoami(["--project-id", PROJECT_ID as string]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(5);
    },
    15_000,
  );
});
