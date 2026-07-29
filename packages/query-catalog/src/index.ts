import { QUERY_DEFINITIONS } from "./queries.generated";

export interface QueryDefinition {
  name: string;
  description: string;
  query: string;
}

export const QUERY_MAP: ReadonlyMap<string, QueryDefinition> = new Map(
  QUERY_DEFINITIONS.map((definition) => [definition.name, definition]),
);

export function getQuery(name: string): QueryDefinition | undefined {
  return QUERY_MAP.get(name.trim().toLowerCase());
}

export function searchQueries(search = ""): QueryDefinition[] {
  const terms = search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return [...QUERY_MAP.values()].filter((definition) => {
    const haystack =
      `${definition.name} ${definition.description} ${definition.query}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
