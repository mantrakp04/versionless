import { describe, expect, test } from "bun:test";

import config from "./vercel.json";

describe("dashboard Vercel routing", () => {
  test("strips the public mount before serving built files", () => {
    expect(config.services.dashboard.routes).toEqual([
      {
        src: "/dashboard",
        transforms: [
          {
            type: "request.path",
            op: "set",
            args: "/",
          },
        ],
      },
      {
        src: "/dashboard/(.*)",
        transforms: [
          {
            type: "request.path",
            op: "set",
            args: "/$1",
          },
        ],
      },
      { handle: "filesystem" },
      { src: "/.*", dest: "/index.html" },
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
