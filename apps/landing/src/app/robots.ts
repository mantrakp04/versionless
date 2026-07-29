import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Public HTML is indexable. Authenticated and machine-only surfaces
      // are also protected with X-Robots-Tag response headers in vercel.json.
      disallow: [
        "/api/",
        "/dashboard",
        "/dashboard/",
        "/demo/orgs/",
        "/demo/rpc/",
        "/demo/teams",
        "/demo/teams/",
        "/demo/users",
        "/demo/users/",
        "/handler/",
        "/llms.mdx/",
      ],
    },
    sitemap: [
      new URL("/sitemap.xml", siteUrl).toString(),
      new URL("/docs/sitemap.xml", siteUrl).toString(),
    ],
    host: siteUrl.origin,
  };
}
