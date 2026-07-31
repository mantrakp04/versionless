import { getVercelOrigin } from "@versionless/env/vercel";
import { devUrls } from "@versionless/env/web";

export function getServerUrl(url: string) {
  const normalized = url.endsWith("/") ? url.slice(0, -1) : url;

  if (!normalized.startsWith("/")) {
    return normalized;
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}${normalized}`;
  }

  const origin = getVercelOrigin() ?? devUrls.server;
  return `${origin}${normalized}`;
}
