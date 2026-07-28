import { Skeleton } from "@versionless/ui/components/skeleton";

import { clientErrorMessage } from "@/utils/client-error";
import type { QueryParameter } from "@/utils/project-query";
import { formatCell, type QuerySource, type QueryTableColumn } from "./query-sql";
import type { QueryRunner } from "./query-runner";
import { useSourceQuery } from "./use-source-query";

export interface QueryStatProps {
  source?: QuerySource;
  query: string;
  params?: Record<string, QueryParameter> | QueryParameter[];
  label: string;
  format?: QueryTableColumn["format"];
  /** Column to read; defaults to the first column of the first row. */
  column?: string;
  hint?: string;
}

type Row = Record<string, unknown>;

export function QueryStat({
  projectId,
  source = "clickhouse",
  query,
  params,
  label,
  format,
  column,
  hint,
  runQuery,
}: QueryStatProps & { projectId: string; runQuery: QueryRunner }) {
  const result = useSourceQuery<Row>({
    name: "stat",
    projectId,
    source,
    query,
    params,
    runQuery,
  });

  const row = result.data?.[0];
  const value = row
    ? (column !== undefined ? row[column] : Object.values(row)[0])
    : undefined;

  return (
    <span className="my-2 inline-flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 align-top">
      <span className="text-muted-foreground text-[0.625rem] uppercase tracking-wide">
        {label}
      </span>
      {result.isPending ? (
        <Skeleton className="h-5 w-16" />
      ) : result.isError ? (
        <span className="text-destructive text-xs">
          {clientErrorMessage(result.error, "Unavailable.")}
        </span>
      ) : (
        <span className="font-medium text-base tabular-nums">
          {formatCell(value, format)}
        </span>
      )}
      {hint ? (
        <span className="text-muted-foreground text-[0.625rem]">{hint}</span>
      ) : null}
    </span>
  );
}
