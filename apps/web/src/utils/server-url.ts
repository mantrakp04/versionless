import { getVercelOrigin } from "@versionless/env/vercel";

export function getServerUrl(url: string) {
  const normalized = url.endsWith("/") ? url.slice(0, -1) : url;

  if (!normalized.startsWith("/")) {
    return normalized;
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}${normalized}`;
  }

  const origin = getVercelOrigin() ?? "http://localhost:3000";
  return `${origin}${normalized}`;
}
