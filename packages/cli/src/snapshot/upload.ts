import { readFileSync } from "node:fs";

import { CliError } from "../errors";

export const DEFAULT_CLOUD_API_URL = "https://api.versionless.dev";
export const DEFAULT_DEVELOPMENT_API_URL = "http://localhost:3000";

export interface ResolveSnapshotApiUrlOptions {
  apiUrl?: string;
  env?: Record<string, string | undefined>;
}

export function resolveSnapshotApiUrl({
  apiUrl,
  env = process.env,
}: ResolveSnapshotApiUrlOptions = {}): string {
  return (
    apiUrl?.trim() ||
    env.VERSIONLESS_API_URL?.trim() ||
    // Backward-compatible name used before apiUrl became SDK configuration.
    env.VERSIONLESS_SERVER_URL?.trim() ||
    (env.NODE_ENV === "production"
      ? DEFAULT_CLOUD_API_URL
      : DEFAULT_DEVELOPMENT_API_URL)
  ).replace(/\/+$/, "");
}

export interface UploadSnapshotOptions {
  apiKey: string;
  project: string;
  path: string;
  serverUrl?: string;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

export interface UploadSnapshotResult {
  projectId: string;
  version: string;
  created: boolean;
}

export async function uploadSnapshot({
  apiKey,
  project,
  path,
  serverUrl = resolveSnapshotApiUrl(),
  fetch: fetchImpl = globalThis.fetch,
}: UploadSnapshotOptions): Promise<UploadSnapshotResult> {
  const baseUrl = serverUrl.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/versions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-versionless-project": project,
      },
      // Upload the bytes that were written to disk, rather than serializing a
      // second in-memory representation that could diverge from the artifact.
      body: readFileSync(path, "utf8"),
    });
  } catch (error) {
    throw new CliError(
      `Could not upload the version snapshot to ${baseUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      5,
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
        : `Versionless rejected the snapshot (HTTP ${response.status})`;
    throw new CliError(message, 5);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("projectId" in body) ||
    typeof body.projectId !== "string" ||
    !("version" in body) ||
    typeof body.version !== "string" ||
    !("created" in body) ||
    typeof body.created !== "boolean"
  ) {
    throw new CliError("Versionless returned an invalid upload response", 5);
  }

  return {
    projectId: body.projectId,
    version: body.version,
    created: body.created,
  };
}
