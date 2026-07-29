import type { MDXComponents } from "mdx/types";
import { Alert, AlertDescription, AlertTitle } from "@versionless/ui/components/alert";
import { Badge } from "@versionless/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@versionless/ui/components/card";
import { Separator } from "@versionless/ui/components/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@versionless/ui/components/table";

import { QueryChart, type QueryChartProps } from "./query-chart";
import { QueryStat, type QueryStatProps } from "./query-stat";
import { QueryTable, type QueryTableProps } from "./query-table";
import type { QueryRunner } from "./query-runner";

function Dashboard({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={[
        "my-3 flex flex-col gap-3 rounded-lg border bg-background/60 p-3 shadow-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-slot="assistant-dashboard"
      {...props}
    />
  );
}

function DashboardGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={[
        "grid gap-2 sm:grid-cols-2 [&>*]:my-0 [&>*]:min-w-0 [&>*]:w-full",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-slot="assistant-dashboard-grid"
      {...props}
    />
  );
}

/**
 * Components in scope for the assistant's MDX. Anything it names that is not
 * here throws during render, which the message's error boundary catches — the
 * system prompt states the same list so the two stay in step.
 *
 * The three live components need the project scope, which is not the model's to
 * choose; the registry binds it here so a `projectId` written into the MDX
 * cannot reach a query.
 */
export function createMdxComponents(
  projectId: string,
  runQuery: QueryRunner,
): MDXComponents {
  const components = {
    Dashboard,
    DashboardGrid,
    QueryTable: (props: QueryTableProps) => (
      <QueryTable {...props} projectId={projectId} runQuery={runQuery} />
    ),
    QueryChart: (props: QueryChartProps) => (
      <QueryChart {...props} projectId={projectId} runQuery={runQuery} />
    ),
    QueryStat: (props: QueryStatProps) => (
      <QueryStat {...props} projectId={projectId} runQuery={runQuery} />
    ),

    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    Badge,
    Alert,
    AlertTitle,
    AlertDescription,
    Separator,
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,

    // Markdown output lands on the intrinsic elements, which MDX also routes
    // through this map. Prose inside a chat bubble is narrow, so these carry
    // tighter spacing than the dashboard's defaults.
    h1: (props: React.ComponentProps<"h2">) => (
      <h2 className="mt-3 mb-1 font-heading font-medium text-sm" {...props} />
    ),
    h2: (props: React.ComponentProps<"h3">) => (
      <h3 className="mt-3 mb-1 font-heading font-medium text-sm" {...props} />
    ),
    h3: (props: React.ComponentProps<"h4">) => (
      <h4 className="mt-2 mb-1 font-medium text-xs" {...props} />
    ),
    p: (props: React.ComponentProps<"p">) => (
      <p className="my-1.5 first:mt-0 last:mb-0" {...props} />
    ),
    ul: (props: React.ComponentProps<"ul">) => (
      <ul className="my-1.5 list-disc space-y-0.5 ps-4" {...props} />
    ),
    ol: (props: React.ComponentProps<"ol">) => (
      <ol className="my-1.5 list-decimal space-y-0.5 ps-4" {...props} />
    ),
    code: (props: React.ComponentProps<"code">) => (
      <code
        className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]"
        {...props}
      />
    ),
    pre: (props: React.ComponentProps<"pre">) => (
      <pre
        className="my-2 overflow-x-auto rounded-md bg-muted p-2 font-mono text-[0.6875rem] [&_code]:bg-transparent [&_code]:p-0"
        {...props}
      />
    ),
    a: (props: React.ComponentProps<"a">) => (
      <a
        className="underline underline-offset-3"
        rel="noreferrer"
        target="_blank"
        {...props}
      />
    ),
    table: (props: React.ComponentProps<"table">) => (
      <div className="my-2 overflow-x-auto rounded-md border">
        <Table {...props} />
      </div>
    ),
    thead: TableHeader,
    tbody: TableBody,
    tr: TableRow,
    th: TableHead,
    td: TableCell,
  };

  return components as unknown as MDXComponents;
}

/** The component names the assistant may use — kept in sync with the prompt. */
export const MDX_COMPONENT_NAMES = [
  "Dashboard",
  "DashboardGrid",
  "QueryTable",
  "QueryChart",
  "QueryStat",
  "Card",
  "CardHeader",
  "CardTitle",
  "CardDescription",
  "CardContent",
  "Badge",
  "Alert",
  "AlertTitle",
  "AlertDescription",
  "Separator",
  "Table",
  "TableHeader",
  "TableBody",
  "TableRow",
  "TableHead",
  "TableCell",
] as const;
