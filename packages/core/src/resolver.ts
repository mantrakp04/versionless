import { VersionResolutionError } from "./errors";
import type { VersionScheme } from "./scheme";
import type { Resolved, ResolveInput, Resolver } from "./types";

function defaultKeyFrom(input: ResolveInput): string | null {
  const auth = input.getHeader("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return input.getHeader("x-api-key");
}

function validate(
  value: string,
  source: Resolved["source"],
  scheme: VersionScheme,
  current: string,
): Resolved {
  const version = value === "current" ? current : value;
  if (!scheme.isValid(version)) {
    throw new VersionResolutionError(value, scheme.name);
  }
  return { version, source, requestedVersion: value === "current" ? undefined : value };
}

/**
 * Runs the resolver chain; first resolver yielding a value wins.
 * Fully synchronous (returns Resolved, not a Promise) when no async apiKey
 * resolver fires — this is the hot path for header-pinned clients.
 */
export function resolveVersion(
  chain: Resolver[],
  input: ResolveInput,
  scheme: VersionScheme,
  current: string,
): Resolved | Promise<Resolved> {
  return step(chain, 0, input, scheme, current);
}

function step(
  chain: Resolver[],
  index: number,
  input: ResolveInput,
  scheme: VersionScheme,
  current: string,
): Resolved | Promise<Resolved> {
  for (let i = index; i < chain.length; i++) {
    const resolver = chain[i]!;

    if ("header" in resolver) {
      const value = input.getHeader(resolver.header);
      if (value) return validate(value, "header", scheme, current);
      continue;
    }

    if ("query" in resolver) {
      if (!input.url) continue;
      const q = input.url.indexOf("?");
      if (q === -1) continue;
      const value = new URLSearchParams(input.url.slice(q + 1)).get(resolver.query);
      if (value) return validate(value, "query", scheme, current);
      continue;
    }

    if ("apiKey" in resolver) {
      const key = (resolver.keyFrom ?? defaultKeyFrom)(input);
      if (!key) continue;
      const pinned = resolver.apiKey(key);
      if (pinned instanceof Promise) {
        const rest = i + 1;
        return pinned.then((value) => {
          if (value) {
            const resolved = validate(value, "apiKey", scheme, current);
            return { ...resolved, consumerKey: key };
          }
          return step(chain, rest, input, scheme, current);
        });
      }
      if (pinned) {
        const resolved = validate(pinned, "apiKey", scheme, current);
        return { ...resolved, consumerKey: key };
      }
      continue;
    }

    // default
    return validate(resolver.default, "default", scheme, current);
  }
  // No resolver matched: fall back to current.
  return { version: current, source: "default" };
}
