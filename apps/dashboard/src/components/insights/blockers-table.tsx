import type { SunsetBlocker, SunsetBlockerSort } from "@/queries/insights";
import { TableCell } from "@versionless/ui/components/table";
import type { ReactNode } from "react";

import { DashboardTable } from "@/components/dashboard-table";
import { relativeTime } from "./format";
import {
  SortableTableHead,
  type TableSortDirection,
} from "./sortable-table-head";

const BLOCKERS_GRID_COLUMNS =
  "minmax(9rem, 1fr) minmax(12rem, 1.5fr) minmax(7rem, .75fr) .65fr minmax(7rem, .8fr)";

export function BlockersTable({
  blockers,
  sort,
  direction,
  onSort,
  isLoading = false,
  isError = false,
  emptyState = "No blocking consumers in this window.",
}: {
  blockers: SunsetBlocker[];
  sort: SunsetBlockerSort;
  direction: TableSortDirection;
  onSort: (sort: SunsetBlockerSort) => void;
  isLoading?: boolean;
  isError?: boolean;
  emptyState?: ReactNode;
}) {
  return (
    <DashboardTable
      items={blockers}
      isLoading={isLoading}
      isError={isError}
      errorState="Sunset blockers are temporarily unavailable."
      gridTemplateColumns={BLOCKERS_GRID_COLUMNS}
      stickyHeader
      getItemKey={(blocker) =>
        `${blocker.consumerKey}-${blocker.route}-${blocker.version}`
      }
      renderHeader={() => (
        <>
          <SortableTableHead
            label="Consumer"
            column="consumer"
            sort={sort}
            direction={direction}
            onSort={onSort}
          />
          <SortableTableHead
            label="Route"
            column="route"
            sort={sort}
            direction={direction}
            onSort={onSort}
          />
          <SortableTableHead
            label="Version"
            column="version"
            sort={sort}
            direction={direction}
            onSort={onSort}
          />
          <SortableTableHead
            label="Requests"
            column="requests"
            sort={sort}
            direction={direction}
            onSort={onSort}
            align="right"
          />
          <SortableTableHead
            label="Last seen"
            column="lastSeen"
            sort={sort}
            direction={direction}
            onSort={onSort}
          />
        </>
      )}
      renderRow={(b) => (
        <>
          <TableCell className="font-mono">{b.consumerKey}</TableCell>
          <TableCell className="font-mono">{b.route}</TableCell>
          <TableCell className="font-mono">{b.version}</TableCell>
          <TableCell className="text-right tabular-nums">
            {b.requests.toLocaleString()}
          </TableCell>
          <TableCell className="text-muted-foreground">
            {relativeTime(b.lastSeen)}
          </TableCell>
        </>
      )}
      emptyState={emptyState}
    />
  );
}
