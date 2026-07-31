import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  defaultPortPrefix,
  portOffsets,
  resolveLocalUrls,
  resolvePortPrefix,
  resolvePorts,
} from "./ports";

describe("PORT_PREFIX blocks", () => {
  test("keeps the historical ports on the default prefix", () => {
    const ports = resolvePorts(undefined);

    expect(ports.server).toBe(3000);
    expect(ports.dashboard).toBe(3001);
    expect(ports.docs).toBe(3002);
    expect(ports.demo).toBe(3003);
    expect(ports.landing).toBe(3004);
  });

  test("moves the whole stack — apps and local services — as one block", () => {
    const ports = resolvePorts("31");

    expect(ports).toEqual({
      server: 3100,
      dashboard: 3101,
      docs: 3102,
      demo: 3103,
      landing: 3104,
      postgres: 3105,
      clickhouseHttp: 3106,
      clickhouseNative: 3107,
      otlpGrpc: 3108,
      otlpHttp: 3109,
      otlpCollectorHttp: 3110,
      envoyAdmin: 3111,
      drizzleStudio: 3112,
    });
  });

  test("gives every service a distinct port within a block", () => {
    const ports = Object.values(resolvePorts("42"));

    expect(new Set(ports).size).toBe(ports.length);
  });

  test("never overlaps a neighbouring prefix's block", () => {
    const offsets = Object.values(portOffsets).map(Number);

    expect(Math.max(...offsets)).toBeLessThan(100);
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0);
  });

  test("rejects prefixes that would not concatenate into a valid port", () => {
    for (const invalid of ["3", "300", "0", "09", "ab", "3.1", "-1"]) {
      expect(() => resolvePortPrefix(invalid)).toThrow("PORT_PREFIX");
    }
  });

  test("treats an unset or blank prefix as the default", () => {
    expect(resolvePortPrefix(undefined)).toBe(defaultPortPrefix);
    expect(resolvePortPrefix("")).toBe(defaultPortPrefix);
    expect(resolvePortPrefix("  ")).toBe(defaultPortPrefix);
    expect(resolvePortPrefix(" 31 ")).toBe("31");
  });

  test("derives the local service URLs from the same block", () => {
    const urls = resolveLocalUrls(resolvePorts("31"));

    expect(urls.server).toBe("http://localhost:3100");
    expect(urls.dashboard).toBe("http://localhost:3101");
    expect(urls.database).toBe(
      "postgresql://postgres:password@localhost:3105/versionless",
    );
    expect(urls.clickhouse).toBe(
      "http://clickhouse:password@localhost:3106/versionless",
    );
    expect(urls.otlpLogs).toBe("http://localhost:3109/v1/logs");
    expect(urls.collectorHttp).toBe("http://127.0.0.1:3110");
  });
});

describe("docker-compose port block", () => {
  const compose = readFileSync(
    new URL("../../../docker-compose.yml", import.meta.url),
    "utf8",
  );

  test("publishes each service on this table's offset", () => {
    const published: Record<string, string> = {
      postgres: "5432",
      clickhouseHttp: "8123",
      clickhouseNative: "9000",
      otlpGrpc: "4317",
      otlpHttp: "4318",
      envoyAdmin: "9901",
    };

    for (const [name, containerPort] of Object.entries(published)) {
      expect(compose).toContain(
        `"\${PORT_PREFIX:-${defaultPortPrefix}}${portOffsets[name as keyof typeof portOffsets]}:${containerPort}"`,
      );
    }

    // The Collector's seed-only boundary is additionally bound to loopback.
    expect(compose).toContain(
      `"127.0.0.1:\${PORT_PREFIX:-${defaultPortPrefix}}${portOffsets.otlpCollectorHttp}:4318"`,
    );
  });

  test("scopes the compose project so worktrees do not share containers", () => {
    expect(compose).toContain(`name: versionless-\${PORT_PREFIX:-${defaultPortPrefix}}`);
    expect(compose).not.toMatch(/container_name: versionless-(?!\$)/);
  });

  test("points the Envoy gateway at this checkout's own API server", () => {
    expect(compose).toContain(
      `AUTH_PORT: "\${PORT_PREFIX:-${defaultPortPrefix}}${portOffsets.server}"`,
    );
  });
});
