export function getInsightsProjectId(pathname: string): string | null {
  const projectId = pathname.match(/^\/insights\/([^/]+)(?:\/|$)/)?.[1];
  return projectId ? decodeURIComponent(projectId) : null;
}

export function preserveInsightsSearch<T>(search: T): T {
  return search;
}
