import { useEffect, useMemo, useRef, useState } from "react";
import {
  infiniteQueryOptions,
  useInfiniteQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { Input } from "@versionless/ui/components/input";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { Spinner } from "@versionless/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@versionless/ui/components/table";

import {
  SortableTableHead,
  useTableSort,
} from "@/components/insights/sortable-table-head";
import { clientErrorMessage } from "@/utils/client-error";
import {
  type QueryParameter,
} from "@/utils/project-query";
import {
  composeTableQuery,
  formatCell,
  type QuerySortDirection,
  type QuerySource,
  type QueryTableColumn,
} from "./query-sql";
import type { QueryRunner } from "./query-runner";

export interface QueryTableProps {
  source?: QuerySource;
  select: string;
  from: string;
  where?: string;
  groupBy?: string;
  params?: Record<string, QueryParameter> | QueryParameter[];
  columns: QueryTableColumn[];
  defaultSort?: { column: string; direction?: QuerySortDirection };
  searchColumn?: string;
  pageSize?: number;
  caption?: string;
}

type Row = Record<string, unknown>;

interface Page {
  rows: Row[];
  nextOffset: number | null;
}

const DEFAULT_PAGE_SIZE = 25;
/** Debounce so a typed search issues one query per pause, not per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

function pageQueryOptions(input: {
  projectId: string;
  source: QuerySource;
  select: string;
  from: string;
  where?: string;
  groupBy?: string;
  modelParams: Record<string, QueryParameter> | QueryParameter[] | undefined;
  sort: string;
  direction: QuerySortDirection;
  searchColumn?: string;
  search: string;
  pageSize: number;
  runQuery: QueryRunner;
}) {
  type Key = readonly ["chat-query-table", typeof input];
  return infiniteQueryOptions<Page, Error, InfiniteData<Page, number>, Key, number>({
    queryKey: ["chat-query-table", input] as const,
    initialPageParam: 0,
    enabled: input.projectId !== "",
    retry: false,
    queryFn: async ({ pageParam }) => {
      const composed = composeTableQuery({
        source: input.source,
        select: input.select,
        from: input.from,
        where: input.where,
        groupBy: input.groupBy,
        sort: input.sort,
        direction: input.direction,
        searchColumn: input.searchColumn,
        search: input.search,
        limit: input.pageSize,
        offset: pageParam,
      });

      const rows = await input.runQuery<Row>({
        source: input.source,
        query: composed.sql,
        params:
          input.source === "postgres"
            ? [
                // Postgres binds by position, so the composer's paging values
                // must follow the model's, not merge with them.
                ...(Array.isArray(input.modelParams) ? input.modelParams : []),
                ...(composed.params as QueryParameter[]),
              ]
            : {
                ...(Array.isArray(input.modelParams)
                  ? {}
                  : (input.modelParams ?? {})),
                ...(composed.params as Record<string, QueryParameter>),
              },
      });

      // The composer asks for one row past the page so "there is more" needs
      // no COUNT query; that row is dropped rather than rendered.
      const hasMore = rows.length > input.pageSize;
      return {
        rows: hasMore ? rows.slice(0, input.pageSize) : rows,
        nextOffset: hasMore ? pageParam + input.pageSize : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
}

/**
 * A server-driven table the assistant can embed in its MDX. Sorting, paging,
 * and searching each recompose the SQL and issue a new query rather than
 * filtering a result already in the browser, so it stays honest on a project
 * with a million rows of telemetry.
 */
export function QueryTable({
  projectId,
  source = "clickhouse",
  select,
  from,
  where,
  groupBy,
  params,
  columns,
  defaultSort,
  searchColumn,
  pageSize = DEFAULT_PAGE_SIZE,
  caption,
  runQuery,
}: QueryTableProps & { projectId: string; runQuery: QueryRunner }) {
  const sortableColumns = columns.filter((column) => column.sortable);
  const initialSort =
    defaultSort?.column ?? sortableColumns[0]?.key ?? columns[0]?.key ?? "";
  const { sort, direction, toggleSort } = useTableSort<string>(initialSort);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = useInfiniteQuery(
    pageQueryOptions({
      projectId,
      source,
      select,
      from,
      where,
      groupBy,
      modelParams: params,
      sort,
      // useTableSort starts descending; honor an explicit ascending default.
      direction: defaultSort?.direction === "asc" && sort === initialSort
        ? "asc"
        : direction,
      searchColumn,
      search,
      pageSize,
      runQuery,
    }),
  );

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.rows) ?? [],
    [query.data],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !query.hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { root, rootMargin: "160px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);

  return (
    <div className="my-3 flex flex-col gap-2">
      {caption ? (
        <p className="text-muted-foreground text-xs">{caption}</p>
      ) : null}
      {searchColumn ? (
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={`Search ${searchColumn}…`}
          className="h-7 max-w-56"
          aria-label={`Search ${searchColumn}`}
        />
      ) : null}

      <div
        ref={scrollRef}
        className="max-h-80 overflow-auto rounded-md border"
      >
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {columns.map((column) =>
                column.sortable ? (
                  <SortableTableHead
                    key={column.key}
                    align={column.align}
                    column={column.key}
                    direction={direction}
                    label={column.label}
                    onSort={toggleSort}
                    sort={sort}
                  />
                ) : (
                  <TableHead
                    key={column.key}
                    className={column.align === "right" ? "text-right" : undefined}
                  >
                    {column.label}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending ? (
              // Dimensionally stable while loading, so the message does not
              // jump as each page arrives.
              Array.from({ length: 5 }, (_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {columns.map((column) => (
                    <TableCell key={column.key}>
                      <Skeleton className="h-3 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : query.isError ? (
              <TableRow>
                <TableCell
                  className="text-destructive"
                  colSpan={columns.length}
                >
                  {clientErrorMessage(
                    query.error,
                    "This query could not be run.",
                  )}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  className="text-muted-foreground"
                  colSpan={columns.length}
                >
                  No rows matched.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => (
                <TableRow key={`${index}-${String(row[columns[0]!.key])}`}>
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={
                        column.align === "right"
                          ? "text-right tabular-nums"
                          : undefined
                      }
                    >
                      {formatCell(row[column.key], column.format)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div ref={sentinelRef} className="h-px" />
        {query.isFetchingNextPage ? (
          <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground text-xs">
            <Spinner className="size-3" />
            Loading more…
          </div>
        ) : null}
      </div>
    </div>
  );
}
