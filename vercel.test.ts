import { describe, expect, test } from "bun:test";

import config from "./vercel.json";

describe("dashboard Vercel routing", () => {
  test("falls back client routes without rewriting built assets to HTML", () => {
    const rewrite = config.services.dashboard.rewrites[0];
    expect(rewrite).toBeDefined();

    const source = new RegExp(`^${rewrite!.source}$`);
    expect(source.test("/insights/internal")).toBe(true);
    expect(source.test("/assets/dashboard.js")).toBe(false);
    expect(source.test("/favicon.svg")).toBe(false);
    expect(source.test("/site.webmanifest")).toBe(false);
    expect(rewrite!.destination).toBe("/index.html");
  });

  test("preserves the dashboard base path when routing into its service", () => {
    const rewrites = config.rewrites.filter(
      (rewrite) =>
        rewrite.source === "/dashboard" ||
        rewrite.source === "/dashboard/:path*",
    );

    expect(rewrites).toHaveLength(2);
    for (const rewrite of rewrites) {
      expect(rewrite.destination).toEqual({ service: "dashboard" });
    }
  });
});
