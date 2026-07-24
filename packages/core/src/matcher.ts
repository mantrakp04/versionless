import { RegistrationError } from "./errors";

export type Segment =
  | { type: "static"; value: string }
  | { type: "param"; name: string };

export interface CompiledPattern {
  method: string;
  segments: Segment[];
  source: string;
  match(method: string, path: string): Record<string, string> | null;
}

/** "GET /users/:id" -> "GET /users/:*" — param names don't matter for indexing. */
export function normalizeRouteKey(routeKey: string): string {
  const { method, path } = splitRouteKey(routeKey);
  const normalized = pathSegments(path)
    .map((s) => (s.startsWith(":") ? ":*" : s))
    .join("/");
  return `${method} /${normalized}`;
}

export function splitRouteKey(routeKey: string): { method: string; path: string } {
  const space = routeKey.indexOf(" ");
  if (space === -1) {
    throw new RegistrationError(
      `Invalid route "${routeKey}" — expected "METHOD /path" (e.g. "GET /users/:id")`,
    );
  }
  const method = routeKey.slice(0, space).toUpperCase();
  const path = routeKey.slice(space + 1).trim();
  if (!path.startsWith("/")) {
    throw new RegistrationError(
      `Invalid route "${routeKey}" — path must start with "/"`,
    );
  }
  return { method, path };
}

function pathSegments(path: string): string[] {
  // Strip trailing slash; keep "" for the root path so "/" round-trips.
  const trimmed = path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed.split("/").slice(1);
}

export function compilePattern(routeKey: string): CompiledPattern {
  const { method, path } = splitRouteKey(routeKey);
  const segments: Segment[] = pathSegments(path).map((raw) => {
    if (raw.includes("*") && raw !== ":*") {
      throw new RegistrationError(
        `Invalid route "${routeKey}" — wildcards are not supported in v0`,
      );
    }
    return raw.startsWith(":")
      ? { type: "param", name: raw.slice(1) }
      : { type: "static", value: raw };
  });

  return {
    method,
    segments,
    source: routeKey,
    match(reqMethod, reqPath) {
      if (reqMethod.toUpperCase() !== method) return null;
      const parts = pathSegments(reqPath.split("?")[0] ?? reqPath);
      if (parts.length !== segments.length) return null;
      const params: Record<string, string> = {};
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        const part = parts[i]!;
        if (seg.type === "static") {
          if (seg.value !== part) return null;
        } else {
          params[seg.name] = decodeURIComponent(part);
        }
      }
      return params;
    },
  };
}

/** Substitute matched params into a target pattern: ("GET /teams/:id", {id: "7"}) -> "/teams/7". */
export function expandPath(
  targetRouteKey: string,
  params: Record<string, string>,
): string {
  const { path } = splitRouteKey(targetRouteKey);
  return (
    "/" +
    pathSegments(path)
      .map((seg) => {
        if (!seg.startsWith(":")) return seg;
        const name = seg.slice(1);
        const value = params[name];
        if (value === undefined) {
          throw new RegistrationError(
            `Rewrite target "${targetRouteKey}" references :${name}, which the source pattern does not capture`,
          );
        }
        return encodeURIComponent(value);
      })
      .join("/")
  );
}
