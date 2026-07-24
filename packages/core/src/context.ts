/**
 * Shared context stash for RPC adapters (tRPC, oRPC). Both frameworks create
 * one context per HTTP request while the exchange is procedure-keyed, so the
 * context stores the raw resolve inputs (instance + header getter) and the
 * per-procedure middleware/interceptor opens the exchange itself, where the
 * procedure path is known.
 */
import type { Versionless } from "./types";

/**
 * Per-request stash created by {@link versionlessContext} and consumed by the
 * adapters' middleware, interceptors, error formatters, and responseMeta
 * helpers.
 */
export interface VersionlessStash {
  v: Versionless;
  getHeader(name: string): string | null;
}

/** Context shape produced by {@link versionlessContext}; merge it into your app's context type. */
export interface VersionlessContext {
  versionless: VersionlessStash;
}

interface HeadersSource {
  headers: { get(name: string): string | null };
}

/**
 * Call where you build the handler context to stash the versionless resolve
 * inputs on it. Accepts either key so both RPC adapters keep their idiomatic
 * call shape:
 *
 * ```ts
 * createContext: ({ req }) => versionlessContext(v, { req })          // tRPC
 * handler.handle(request, { context: { ...versionlessContext(v, { request }) } })  // oRPC
 * ```
 */
export function versionlessContext(
  v: Versionless,
  opts: { req: HeadersSource } | { request: HeadersSource },
): VersionlessContext {
  const source = "req" in opts ? opts.req : opts.request;
  return {
    versionless: {
      v,
      getHeader: (name) => source.headers.get(name),
    },
  };
}

/** Read the stash back off an unknown adapter context, when present and well-formed. */
export function stashFrom(ctx: unknown): VersionlessStash | undefined {
  const stash = (ctx as Partial<VersionlessContext> | null | undefined)
    ?.versionless;
  return stash && typeof stash.getHeader === "function" ? stash : undefined;
}

const warnedMissingStash = new Set<string>();

/** Warn once per message that a context stash is missing (misconfigured wiring). */
export function warnMissingStash(message: string): void {
  if (warnedMissingStash.has(message)) return;
  warnedMissingStash.add(message);
  console.warn(message);
}
