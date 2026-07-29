import { describe, expect, test } from "bun:test";

import config from "./vercel.json";

describe("dashboard Vercel routing", () => {
  test("serves built files before applying the client-route fallback", () => {
    expect(config.services.dashboard.routes).toEqual([
      { handle: "filesystem" },
      { src: "/.*", dest: "/index.html" },
    ]);
  });

  test("strips the public mount before routing into the dashboard service", () => {
    const rewrites = config.rewrites.filter(
      (rewrite) =>
        rewrite.source === "/dashboard" ||
        rewrite.source === "/dashboard/:path*",
    );

    expect(rewrites).toHaveLength(2);
    expect(rewrites).toEqual([
      {
        source: "/dashboard",
        destination: { service: "dashboard", path: "/" },
      },
      {
        source: "/dashboard/:path*",
        destination: { service: "dashboard", path: "/:path*" },
      },
    ]);
  });
});
