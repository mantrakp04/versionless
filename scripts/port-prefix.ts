/**
 * Picks a free PORT_PREFIX block, so a second worktree does not start its
 * stack on top of one that is already running.
 *
 * A block is taken if any port in it answers on loopback, or if a compose
 * project named after it exists (containers can be stopped but still hold the
 * names and volumes).
 *
 *   export PORT_PREFIX=$(bun run --silent port-prefix)   # first free block
 *   bun run port-prefix --list                           # who holds what
 *
 * The chosen prefix goes to stdout alone so it can be captured; everything
 * else is stderr.
 */
import { connect } from "node:net";

import { portOffsets, resolvePorts } from "@versionless/env/ports";

/** Blocks to consider, in preference order: 30 first, then 31, 32, … */
const CANDIDATE_PREFIXES = Array.from({ length: 70 }, (_, i) => String(30 + i));

const PROBE_TIMEOUT_MS = 250;

/** True when something is listening — i.e. the block is already in use. */
function isPortBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const settle = (busy: boolean) => {
      socket.destroy();
      resolve(busy);
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

/** Names of the services holding ports in a block, empty when it is free. */
async function busyServices(prefix: string): Promise<string[]> {
  const ports = resolvePorts(prefix);
  const probes = await Promise.all(
    Object.keys(portOffsets).map(async (name) => ({
      name,
      busy: await isPortBusy(ports[name as keyof typeof ports]),
    })),
  );

  return probes.filter((probe) => probe.busy).map((probe) => probe.name);
}

/**
 * Prefixes already claimed by a compose project, running or not. Parsed from
 * `docker compose ls -a`; an unavailable Docker is not an error — the port
 * probe still covers everything that is actually listening.
 */
export function parseComposePrefixes(output: string): Set<string> {
  const claimed = new Set<string>();

  for (const match of output.matchAll(/versionless-(\d{2})\b/g)) {
    claimed.add(match[1]!);
  }

  return claimed;
}

async function composePrefixes(): Promise<Set<string>> {
  try {
    const proc = Bun.spawn(["docker", "compose", "ls", "-a", "--format", "json"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return new Set();
    return parseComposePrefixes(output);
  } catch {
    return new Set();
  }
}

export interface BlockStatus {
  prefix: string;
  services: string[];
  compose: boolean;
}

export function isFree({ services, compose }: BlockStatus): boolean {
  return services.length === 0 && !compose;
}

async function inspect(prefixes: string[]): Promise<BlockStatus[]> {
  const claimed = await composePrefixes();

  return Promise.all(
    prefixes.map(async (prefix) => ({
      prefix,
      services: await busyServices(prefix),
      compose: claimed.has(prefix),
    })),
  );
}

function describe(status: BlockStatus): string {
  const held = [
    ...(status.compose ? ["compose project"] : []),
    ...status.services,
  ];
  return held.length === 0 ? "free" : `in use — ${held.join(", ")}`;
}

async function main() {
  const list = Bun.argv.includes("--list");

  if (list) {
    // A short window is enough to see the neighbours; scanning all 70 blocks
    // just to print a table is not worth the probe time.
    const statuses = await inspect(CANDIDATE_PREFIXES.slice(0, 10));
    for (const status of statuses) {
      const ports = resolvePorts(status.prefix);
      console.error(
        `PORT_PREFIX=${status.prefix}  (${ports.server}–${ports.drizzleStudio})  ${describe(status)}`,
      );
    }
    return;
  }

  for (const prefix of CANDIDATE_PREFIXES) {
    const [status] = await inspect([prefix]);
    if (status && isFree(status)) {
      console.error(
        `PORT_PREFIX=${prefix} — server :${resolvePorts(prefix).server}, dashboard :${resolvePorts(prefix).dashboard}, …`,
      );
      console.log(prefix);
      return;
    }
  }

  console.error(
    `No free port block between ${CANDIDATE_PREFIXES[0]} and ${CANDIDATE_PREFIXES.at(-1)}; stop a stack with \`PORT_PREFIX=<prefix> bun stop-deps\`.`,
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
