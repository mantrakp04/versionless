import { describe, expect, test } from "bun:test";

import config from "./vercel.json";

describe("dashboard Vercel routing", () => {
  test("serves mounted build files before applying the SPA fallback", () => {
    expect(config.services.dashboard.outputDirectory).toBe("dist");
    expect(config.services.dashboard.routes).toEqual([
      { handle: "filesystem" },
      {
        src: "/dashboard(?:/.*)?",
        dest: "/dashboard/index.html",
      },
    ]);
  });

  test("preserves the public path when routing into the dashboard service", () => {
    const rewrites = config.rewrites.filter(
      (rewrite) =>
        rewrite.source === "/dashboard" ||
        rewrite.source === "/dashboard/:path*",
    );

    expect(rewrites).toHaveLength(2);
    expect(rewrites).toEqual([
      {
        source: "/dashboard",
        destination: { service: "dashboard" },
      },
      {
        source: "/dashboard/:path*",
        destination: { service: "dashboard" },
      },
    ]);
  });
});
