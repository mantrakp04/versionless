/**
 * One prefixed port block per checkout, so several worktrees — and the agents
 * working in them — can run the whole stack side by side.
 *
 * `PORT_PREFIX` is the two-digit high half of every port the stack binds; each
 * service owns a fixed two-digit offset under it. The default prefix `30`
 * reproduces the historical app ports (server 3000, dashboard 3001, docs 3002,
 * demo 3003, landing 3004) and pulls the docker-compose services into the same
 * block instead of leaving them on their upstream defaults.
 *
 *   PORT_PREFIX=31 → server 3100, dashboard 3101, postgres 3105, …
 *
 * Ports are built by string concatenation, never arithmetic, so
 * `docker-compose.yml` can spell exactly the same thing with
 * `"${PORT_PREFIX:-30}05:5432"` and cannot drift from this table.
 *
 * This module is pure: it reads no environment. `./local` binds it to
 * `process.env` for Node/Bun, `./web` binds it to `import.meta.env` for the
 * browser bundles.
 */

export const defaultPortPrefix = "30";

/** Two-digit offset each service owns inside its prefix block. */
export const portOffsets = {
  /** apps/server — Elysia + tRPC cloud server. */
  server: "00",
  /** apps/dashboard — Vite dev server, mounted at /dashboard. */
  dashboard: "01",
  /** apps/docs — fumadocs, mounted at /docs. */
  docs: "02",
  /** apps/demo — TanStack Start demo, mounted at /demo. */
  demo: "03",
  /** apps/landing — Next.js marketing site at /. */
  landing: "04",
  /** docker-compose postgres (container port 5432). */
  postgres: "05",
  /** docker-compose clickhouse HTTP interface (container port 8123). */
  clickhouseHttp: "06",
  /** docker-compose clickhouse native protocol (container port 9000). */
  clickhouseNative: "07",
  /** Envoy OTLP gateway, gRPC (container port 4317). */
  otlpGrpc: "08",
  /** Envoy OTLP gateway, HTTP (container port 4318). */
  otlpHttp: "09",
  /** Collector's seed-only trusted OTLP/HTTP boundary (container port 4318). */
  otlpCollectorHttp: "10",
  /** Envoy admin interface (container port 9901). */
  envoyAdmin: "11",
  /** `bun db:studio` — drizzle-kit's local schema browser. */
  drizzleStudio: "12",
} as const;

export type PortName = keyof typeof portOffsets;

export type StackPorts = Record<PortName, number>;

/**
 * Validates a raw `PORT_PREFIX`. Two digits, 10–99: below 10 a one-digit
 * prefix would produce privileged ports and collide with the next block, and
 * anything wider breaks the `${PORT_PREFIX}${offset}` concatenation shared
 * with docker-compose.
 */
export function resolvePortPrefix(raw?: string | null): string {
  const prefix = raw?.trim();
  if (!prefix) return defaultPortPrefix;

  if (!/^[1-9][0-9]$/.test(prefix)) {
    throw new Error(
      `PORT_PREFIX must be two digits between 10 and 99, got ${JSON.stringify(raw)}`,
    );
  }

  return prefix;
}

/** Every port the local stack binds, for one `PORT_PREFIX`. */
export function resolvePorts(rawPrefix?: string | null): StackPorts {
  const prefix = resolvePortPrefix(rawPrefix);
  const ports = {} as StackPorts;

  for (const [name, offset] of Object.entries(portOffsets)) {
    ports[name as PortName] = Number(`${prefix}${offset}`);
  }

  return ports;
}

/** The localhost URLs the stack's own services reach each other on in dev. */
export function resolveLocalUrls(ports: StackPorts) {
  const otlpHttp = `http://localhost:${ports.otlpHttp}`;

  return {
    server: `http://localhost:${ports.server}`,
    dashboard: `http://localhost:${ports.dashboard}`,
    docs: `http://localhost:${ports.docs}`,
    demo: `http://localhost:${ports.demo}`,
    landing: `http://localhost:${ports.landing}`,
    database: `postgresql://postgres:password@localhost:${ports.postgres}/versionless`,
    clickhouse: `http://clickhouse:password@localhost:${ports.clickhouseHttp}/versionless`,
    otlpHttp,
    otlpLogs: `${otlpHttp}/v1/logs`,
    // Seed-only trusted boundary: bound to loopback by docker-compose, so it
    // is addressed by IP rather than through the gateway.
    collectorHttp: `http://127.0.0.1:${ports.otlpCollectorHttp}`,
  };
}
