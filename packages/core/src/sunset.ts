import type { ChangeRegistry } from "./registry";
import type { SunsetCheck, SunsetEntry } from "./types";

const EMPTY: SunsetCheck = { headers: {}, gone: null };

/** End of the sunset day, UTC: versions are gone strictly after this instant. */
function sunsetInstant(after: string): Date {
  const [y, m, d] = after.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

function applicable(
  registry: ChangeRegistry,
  version: string,
): SunsetEntry | null {
  // A sunset on X applies to every version <= X. If several apply, the one
  // with the earliest cutoff wins (it is the binding constraint).
  let winner: SunsetEntry | null = null;
  for (const entry of registry.sunsets) {
    if (registry.scheme.compare(version, entry.version) > 0) continue;
    if (!winner || entry.after < winner.after) winner = entry;
  }
  return winner;
}

interface CacheEntry {
  check: SunsetCheck;
  expires: number;
}

export class SunsetGate {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private registry: ChangeRegistry,
    private clock: () => Date,
  ) {}

  check(version: string): SunsetCheck {
    const now = this.clock();
    const cached = this.cache.get(version);
    if (cached && cached.expires > now.getTime()) return cached.check;

    const entry = applicable(this.registry, version);
    let check: SunsetCheck;
    if (!entry) {
      check = EMPTY;
    } else {
      const instant = sunsetInstant(entry.after);
      const headers: Record<string, string> = {
        // RFC 9745 (Deprecation) + RFC 8594 (Sunset).
        Deprecation: `@${Math.floor(instant.getTime() / 1000)}`,
        Sunset: instant.toUTCString(),
      };
      check = {
        headers,
        gone:
          now.getTime() > instant.getTime()
            ? {
                status: 410,
                body: {
                  error: "api_version_sunset",
                  code: "VERSION_SUNSET",
                  version: entry.version,
                  sunset: entry.after,
                  ...(entry.message ? { message: entry.message } : {}),
                },
              }
            : null,
      };
    }
    // The gone flip is time-dependent; 60s TTL keeps per-request cost at a
    // map hit without serving a stale verdict for long.
    this.cache.set(version, { check, expires: now.getTime() + 60_000 });
    return check;
  }
}
