import { CliError } from "../errors";
import { credentialKey, readCredential } from "./credentials";

/**
 * Minimal client for Hexclave's CLI authentication flow
 * (https://docs.hexclave.com/guides/apps/authentication/cli-authentication):
 * initiate → user confirms in the browser → poll → store the refresh token,
 * then exchange it for short-lived access tokens on demand.
 */

export const DEFAULT_API_URL = "https://api.hexclave.com";

export interface HexclaveSettings {
  /** REST base, no trailing slash (endpoints live under /api/v1). */
  apiUrl: string;
  projectId: string;
  /** Browser origin serving /handler/cli-auth-confirm. */
  appUrl: string;
  /** Only needed when the project enables requirePublishableClientKey. */
  publishableClientKey?: string;
}

export interface SettingsFlags {
  projectId?: string;
  apiUrl?: string;
  appUrl?: string;
  clientKey?: string;
}

const stripSlash = (url: string): string => url.replace(/\/+$/, "");

/**
 * Flags win over the consumer's environment (HEXCLAVE_PROJECT_ID etc., the
 * same names apps/server uses, so a repo .env just works). The app URL
 * defaults to the project's Hexclave-hosted handler pages.
 */
export function resolveHexclaveSettings(flags: SettingsFlags = {}): HexclaveSettings {
  const projectId = flags.projectId ?? process.env.HEXCLAVE_PROJECT_ID;
  if (projectId === undefined || projectId.length === 0) {
    throw new CliError(
      "A Hexclave project id is required: pass --project-id or set HEXCLAVE_PROJECT_ID",
      2,
    );
  }
  const apiUrl = stripSlash(
    flags.apiUrl ?? process.env.HEXCLAVE_API_URL ?? DEFAULT_API_URL,
  );
  // The rebranded built-with-hexclave.com domain does not resolve (checked
  // 2026-07-24); hosted handler pages are still served from the legacy domain.
  const appUrl = stripSlash(
    flags.appUrl ??
      process.env.HEXCLAVE_APP_URL ??
      `https://${projectId}.built-with-stack-auth.com`,
  );
  const publishableClientKey =
    flags.clientKey ?? process.env.HEXCLAVE_PUBLISHABLE_CLIENT_KEY;
  return { apiUrl, projectId, appUrl, publishableClientKey };
}

async function request(
  settings: HexclaveSettings,
  method: "GET" | "POST",
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "x-hexclave-access-type": "client",
    "x-hexclave-project-id": settings.projectId,
    ...options.headers,
  };
  if (settings.publishableClientKey !== undefined) {
    headers["x-hexclave-publishable-client-key"] = settings.publishableClientKey;
  }
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${settings.apiUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (err) {
    throw new CliError(
      `Could not reach Hexclave at ${settings.apiUrl}: ${err instanceof Error ? err.message : String(err)}`,
      5,
    );
  }

  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // fall through: non-JSON bodies are only interesting in the error message
  }
  if (!response.ok) {
    const detail =
      typeof json["error"] === "string" ? json["error"] : text.slice(0, 200);
    throw new CliError(
      `Hexclave request ${method} ${path} failed (${response.status})${detail ? `: ${detail}` : ""}`,
      5,
    );
  }
  return json;
}

export interface CliAuthInitiation {
  pollingCode: string;
  loginCode: string;
  expiresAt?: string;
  /** URL the user opens in the browser to confirm the login. */
  loginUrl: string;
}

export async function initiateCliAuth(
  settings: HexclaveSettings,
  expiresInMillis: number,
): Promise<CliAuthInitiation> {
  const body = await request(settings, "POST", "/api/v1/auth/cli", {
    body: { expires_in_millis: expiresInMillis },
  });
  const pollingCode = body["polling_code"];
  const loginCode = body["login_code"];
  if (typeof pollingCode !== "string" || typeof loginCode !== "string") {
    throw new CliError("Hexclave returned an unexpected /auth/cli response", 5);
  }
  return {
    pollingCode,
    loginCode,
    expiresAt: typeof body["expires_at"] === "string" ? body["expires_at"] : undefined,
    loginUrl: `${settings.appUrl}/handler/cli-auth-confirm?login_code=${encodeURIComponent(loginCode)}`,
  };
}

export type CliAuthPoll =
  | { status: "waiting" }
  | { status: "success"; refreshToken: string }
  | { status: "expired" }
  | { status: "used" };

export async function pollCliAuth(
  settings: HexclaveSettings,
  pollingCode: string,
): Promise<CliAuthPoll> {
  const body = await request(settings, "POST", "/api/v1/auth/cli/poll", {
    body: { polling_code: pollingCode },
  });
  const status = body["status"];
  if (status === "success") {
    const refreshToken = body["refresh_token"];
    if (typeof refreshToken !== "string") {
      throw new CliError(
        "Hexclave reported success without a refresh token",
        5,
      );
    }
    return { status, refreshToken };
  }
  if (status === "waiting" || status === "expired" || status === "used") {
    return { status };
  }
  throw new CliError(`Hexclave returned unknown poll status "${String(status)}"`, 5);
}

export async function refreshAccessToken(
  settings: HexclaveSettings,
  refreshToken: string,
): Promise<string> {
  const body = await request(
    settings,
    "POST",
    "/api/v1/auth/sessions/current/refresh",
    { headers: { "x-hexclave-refresh-token": refreshToken } },
  );
  const accessToken = body["access_token"];
  if (typeof accessToken !== "string") {
    throw new CliError("Hexclave refresh did not return an access token", 5);
  }
  return accessToken;
}

export interface HexclaveUser {
  id: string;
  displayName?: string;
  primaryEmail?: string;
}

export async function getCurrentUser(
  settings: HexclaveSettings,
  accessToken: string,
): Promise<HexclaveUser> {
  const body = await request(settings, "GET", "/api/v1/users/me", {
    headers: { "x-hexclave-access-token": accessToken },
  });
  if (typeof body["id"] !== "string") {
    throw new CliError("Hexclave returned an unexpected /users/me response", 5);
  }
  return {
    id: body["id"],
    displayName:
      typeof body["display_name"] === "string" ? body["display_name"] : undefined,
    primaryEmail:
      typeof body["primary_email"] === "string" ? body["primary_email"] : undefined,
  };
}

/**
 * Access token for the stored login, for commands that call authenticated
 * APIs. Exit 5 with a login hint when the user has not run `versionless login`.
 */
export async function getAccessToken(
  settings: HexclaveSettings,
): Promise<string> {
  const stored = readCredential(credentialKey(settings.apiUrl, settings.projectId));
  if (stored === null) {
    throw new CliError(
      `Not logged in to project ${settings.projectId} — run \`versionless login\``,
      5,
    );
  }
  return refreshAccessToken(settings, stored.refreshToken);
}
