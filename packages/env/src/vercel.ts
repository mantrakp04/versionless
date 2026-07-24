/**
 * Origin of the current Vercel deployment, if any. Production deployments
 * prefer the stable production URL; previews prefer the deployment URL.
 *
 * Lives in `@versionless/env` so the raw `process.env` reads for the
 * Vercel-provided variables stay inside this package. Safe to import from
 * browser bundles: it only touches `process` when one exists (SSR/tests).
 */
export function getVercelOrigin(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const vercelUrl =
    process.env.VERCEL_ENV === "production"
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
      : (process.env.VERCEL_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!vercelUrl) return undefined;
  return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
}
