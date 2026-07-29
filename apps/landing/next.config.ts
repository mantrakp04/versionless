import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The landing service shares the versionless.vercel.app domain with
  // apps/docs, which owns bare /_next. Prefixing our assets keeps the two
  // Next apps from colliding; vercel.json maps /landing/* back into this
  // service's /_next output.
  assetPrefix: "/landing",
};

export default config;
