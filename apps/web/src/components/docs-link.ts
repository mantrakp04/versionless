export function docsHref(isDevelopment: boolean): string {
  return isDevelopment ? "http://localhost:3002/docs" : "/docs";
}
