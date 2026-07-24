import type {
  InsightsSortDirection,
  VersionSort,
  VersionSummary,
} from "@/queries/insights";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@versionless/ui/components/badge";
import { TableCell } from "@versionless/ui/components/table";

import { InfiniteDashboardTable } from "@/components/dashboard-table";
import { versionPagesQueryOptions } from "@/queries/insights";
import { relativeTime } from "./format";
import { SortableTableHead } from "./sortable-table-head";

const VERSION_GRID_COLUMNS = "minmax(8rem, 1.15fr) 0.65fr 0.8fr 1fr 1.5fr";

function versionKey(version: VersionSummary) {
  return version.version;
}

export function VersionsTable({
  projectId,
  days,
  sort,
  direction,
  onSort,
}: {
  projectId: string;
  days: number;
  sort: VersionSort;
  direction: InsightsSortDirection;
  onSort: (sort: VersionSort) => void;
}) {
  const queryClient = useQueryClient();

  return (
    <InfiniteDashboardTable
      queryOptions={versionPagesQueryOptions(queryClient, {
        days,
        projectId,
        sort,
        direction,
        limit: 2,
      })}
      navigationKey={`versions:${projectId}`}
      getItemKey={versionKey}
      gridTemplateColumns={VERSION_GRID_COLUMNS}
      skeleton={{
        rows: 4,
        rowHeight: 36,
        columnWidths: ["7rem", "2rem", "4rem", "7rem", "9rem"],
      }}
      renderHeader={() => (
        <>
          <SortableTableHead
            label="Version"
            column="version"
            sort={sort}
            direction={direction}
            onSort={onSort}
          />
          <SortableTableHead
            label="Clients"
            column="clients"
            sort={sort}
            direction={direction}
            onSort={onSort}
            align="right"
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
          <SortableTableHead
            label="Sunset"
            column="sunsetAfter"
            sort={sort}
            direction={direction}
            onSort={onSort}
          />
        </>
      )}
      renderRow={(version: VersionSummary) => (
        <>
          <TableCell className="font-mono">{version.version}</TableCell>
          <TableCell className="text-right tabular-nums">
            {version.clients.toLocaleString()}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {version.requests.toLocaleString()}
          </TableCell>
          <TableCell className="text-muted-foreground">
            {version.lastSeen ? relativeTime(version.lastSeen) : "never"}
          </TableCell>
          <TableCell>
            {version.sunsetAfter ? (
              <Badge variant="destructive">
                sunset scheduled {version.sunsetAfter}
              </Badge>
            ) : null}
          </TableCell>
        </>
      )}
      errorState="Version traffic is temporarily unavailable."
    />
  );
}
