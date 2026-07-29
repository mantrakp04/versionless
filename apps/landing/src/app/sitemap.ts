import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

// Docs pages ship their own sitemap, exposed at /docs/sitemap.xml and listed
// alongside this one in robots.txt.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: new URL("/", siteUrl).toString(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
