import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredCredential {
  /** Long-lived Hexclave refresh token. Access tokens are never persisted. */
  refreshToken: string;
  userId?: string;
  primaryEmail?: string;
  savedAt: string;
}

interface CredentialsFile {
  version: 1;
  /** Keyed by `credentialKey(apiUrl, projectId)`. */
  credentials: Record<string, StoredCredential>;
}

/**
 * Per-user CLI state directory: $VERSIONLESS_CONFIG_DIR (tests/overrides) →
 * $XDG_CONFIG_HOME/versionless → ~/.config/versionless.
 */
export function configDir(): string {
  const override = process.env.VERSIONLESS_CONFIG_DIR;
  if (override !== undefined && override.length > 0) return override;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base =
    xdg !== undefined && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "versionless");
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

/** One stored login per (API host, project) pair. */
export function credentialKey(apiUrl: string, projectId: string): string {
  return `${projectId}@${apiUrl}`;
}

function readFile(): CredentialsFile {
  const path = credentialsPath();
  if (!existsSync(path)) return { version: 1, credentials: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CredentialsFile;
    if (parsed.version !== 1 || typeof parsed.credentials !== "object") {
      return { version: 1, credentials: {} };
    }
    return parsed;
  } catch {
    return { version: 1, credentials: {} };
  }
}

function writeFile(file: CredentialsFile): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const path = credentialsPath();
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync's mode only applies on create; keep tokens 0600 either way.
  chmodSync(path, 0o600);
}

export function readCredential(key: string): StoredCredential | null {
  return readFile().credentials[key] ?? null;
}

export function writeCredential(key: string, credential: StoredCredential): void {
  const file = readFile();
  file.credentials[key] = credential;
  writeFile(file);
}

/** Returns true when a credential existed and was removed. */
export function deleteCredential(key: string): boolean {
  const file = readFile();
  if (!(key in file.credentials)) return false;
  delete file.credentials[key];
  if (Object.keys(file.credentials).length === 0 && existsSync(credentialsPath())) {
    unlinkSync(credentialsPath());
  } else {
    writeFile(file);
  }
  return true;
}
