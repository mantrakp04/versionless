import type { QueryParameter } from "@/utils/project-query";

export type QuerySource = "clickhouse" | "postgres";
export type QuerySortDirection = "asc" | "desc";

export interface QueryTableColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  sortable?: boolean;
  format?: "number" | "duration" | "percent" | "datetime";
}

export interface ComposeInput {
  source: QuerySource;
  select: string;
  from: string;
  where?: string;
  groupBy?: string;
  /** Column alias to order by; must be one produced by `select`. */
  sort?: string;
  direction?: QuerySortDirection;
  /** Alias the search box filters on, and the term typed into it. */
  searchColumn?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface ComposedQuery {
  sql: string;
  /**
   * Parameters the composer itself contributes, merged over the model's. The
   * search term is bound, never interpolated: the connection is read-only, but
   * a `'` typed into the search box must not be able to end the string.
   */
  params: Record<string, QueryParameter> | QueryParameter[];
}

/**
 * Splits the model's `params` into the shape the target store binds with.
 * ClickHouse takes a named record, Postgres an ordered array; the model may
 * write either, and sending the wrong one is a hard driver error rather than a
 * bad result, so it is normalized here instead of trusted.
 */
export function splitParams(
  source: QuerySource,
  params: Record<string, QueryParameter> | QueryParameter[] | undefined,
): { named: Record<string, QueryParameter>; positional: QueryParameter[] } {
  if (source === "postgres") {
    return { named: {}, positional: Array.isArray(params) ? params : [] };
  }
  return {
    named: Array.isArray(params) ? {} : (params ?? {}),
    positional: [],
  };
}

/** ClickHouse and Postgres both accept these as bare identifiers. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isSafeIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

/**
 * Builds the paged, sorted, searched query the table actually runs.
 *
 * The model supplies the shape of the data (`select` / `from` / `where` /
 * `groupBy`) and this composes the interaction clauses on top, so every sort,
 * page, and keystroke becomes a new server-side query instead of client-side
 * work over a result that was already fetched in full.
 *
 * `sort` and `searchColumn` are checked against a bare-identifier pattern
 * rather than bound as parameters, because neither store lets a parameter
 * stand in for a column name. Anything else is dropped.
 *
 * One row beyond `limit` is requested so the caller can tell "this is the last
 * page" from "there is more" without a second COUNT query.
 */
export function composeTableQuery(input: ComposeInput): ComposedQuery {
  const clauses: string[] = [];
  const searchTerm = input.search?.trim() ?? "";
  const searchable =
    input.searchColumn !== undefined &&
    isSafeIdentifier(input.searchColumn) &&
    searchTerm.length > 0;

  if (input.where && input.where.trim().length > 0) {
    clauses.push(`(${input.where.trim()})`);
  }

  const clickhouse = input.source === "clickhouse";
  if (searchable) {
    clauses.push(
      clickhouse
        ? `positionCaseInsensitive(toString(${input.searchColumn}), {vlSearch: String}) > 0`
        : `${input.searchColumn}::text ILIKE $1`,
    );
  }

  const lines = [`SELECT ${input.select}`, `FROM ${input.from}`];
  if (clauses.length > 0) lines.push(`WHERE ${clauses.join(" AND ")}`);
  if (input.groupBy && input.groupBy.trim().length > 0) {
    lines.push(`GROUP BY ${input.groupBy.trim()}`);
  }
  if (input.sort && isSafeIdentifier(input.sort)) {
    lines.push(
      `ORDER BY ${input.sort} ${input.direction === "asc" ? "ASC" : "DESC"}`,
    );
  }

  // A grouped query's search predicate filters the grouping key, which is a
  // plain column at WHERE time — so it stays in WHERE and never needs HAVING.
  if (clickhouse) {
    lines.push("LIMIT {vlLimit: UInt32} OFFSET {vlOffset: UInt32}");
    return {
      sql: lines.join("\n"),
      params: {
        vlLimit: input.limit + 1,
        vlOffset: input.offset,
        ...(searchable ? { vlSearch: searchTerm } : {}),
      },
    };
  }

  // Postgres binds by position, so the search term (when present) is always
  // $1 and the paging values follow it.
  const params: QueryParameter[] = searchable ? [searchTerm] : [];
  params.push(input.limit + 1, input.offset);
  lines.push(`LIMIT $${params.length - 1} OFFSET $${params.length}`);
  return { sql: lines.join("\n"), params };
}

/** Renders a cell value using the column's declared format. */
export function formatCell(
  value: unknown,
  format: QueryTableColumn["format"],
): string {
  if (value === null || value === undefined) return "—";
  if (format === undefined) return String(value);

  if (format === "datetime") {
    // ClickHouse hands back "YYYY-MM-DD HH:MM:SS" in UTC, which Date parses
    // inconsistently across engines until it is normalized to ISO.
    const raw = String(value);
    const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? raw : date.toLocaleString();
  }

  // Counts come back as strings from both drivers for 64-bit columns.
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);

  switch (format) {
    case "number":
      return new Intl.NumberFormat("en", {
        notation: numeric >= 10_000 ? "compact" : "standard",
        maximumFractionDigits: 1,
      }).format(numeric);
    case "duration":
      return numeric >= 1_000
        ? `${(numeric / 1_000).toFixed(2)} s`
        : `${numeric.toFixed(numeric < 10 ? 1 : 0)} ms`;
    case "percent": {
      // A share arrives either as 0–1 or as an already-scaled percentage;
      // values above 1 are read as the latter so 45 does not render "4500%".
      const percent = numeric > 1 ? numeric : numeric * 100;
      return `${percent.toFixed(percent < 10 ? 1 : 0)}%`;
    }
  }
}
