import { devUrls } from "@versionless/env/web";

export function docsHref(isDevelopment: boolean): string {
  return isDevelopment ? devUrls.docs : "/docs";
}
