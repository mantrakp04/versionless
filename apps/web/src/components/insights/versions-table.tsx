import type {
  InsightsSortDirection,
  VersionSort,
  VersionSummary,
} from "@/queries/insights";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@versionless/ui/components/badge";
import { TableCell, TableHead } from "@versionless/ui/components/table";
import { useMemo } from "react";

import { InfiniteDashboardTable } from "@/components/dashboard-table";
import type { InsightsTimeRangeDays } from "@/components/insights/time-range-control";
import { useProjectReleases } from "@/hooks/use-project-releases";
import { versionPagesQueryOptions } from "@/queries/insights";
import { trpc } from "@/utils/trpc";
import { relativeTime } from "./format";
import { SortableTableHead } from "./sortable-table-head";

const VERSION_GRID_COLUMNS =
  "minmax(8rem, 1.1fr) 0.55fr 0.7fr 0.9fr minmax(9rem, 1.2fr) 1.35fr";

export function defaultVersionSortDirection(
  column: VersionSort,
): InsightsSortDirection {
  return column === "sunsetAfter" ? "desc" : "asc";
}

function versionKey(version: VersionSummary) {
  return version.version;
}

export function VersionConfigSummary({
  endpointCount,
  modelCount,
}: {
  endpointCount: number;
  modelCount: number;
}) {
  return (
    <span className="text-[0.6875rem] text-muted-foreground">
      {endpointCount} endpoints · {modelCount} models
    </span>
  );
}

export function VersionsTable({
  projectId,
  days,
  sort,
  direction,
  onSort,
  onVersionClick,
}: {
  projectId: string;
  days: InsightsTimeRangeDays;
  sort: VersionSort;
  direction: InsightsSortDirection;
  onSort: (sort: VersionSort) => void;
  onVersionClick: (version: string) => void;
}) {
  const queryClient = useQueryClient();
  const contracts = useQuery(
    trpc.projects.versions.queryOptions({ projectId }),
  );
  const releases = useProjectReleases(projectId);
  const contractsByVersion = useMemo(
    () =>
      new Map(contracts.data?.map((detail) => [detail.version, detail]) ?? []),
    [contracts.data],
  );

  return (
    <InfiniteDashboardTable
      queryOptions={versionPagesQueryOptions(queryClient, {
        days,
        projectId,
        sort,
        direction,
        limit: 2,
        releases: {
          versions: releases.versions,
          sunsets: releases.sunsets,
        },
      })}
      navigationKey={`versions:${projectId}:${sort}:${direction}`}
      getItemKey={versionKey}
      gridTemplateColumns={VERSION_GRID_COLUMNS}
      stickyHeader
      getRowAriaLabel={(version) =>
        `View version details for ${version.version}`
      }
      onRowActivate={(version) => onVersionClick(version.version)}
      skeleton={{
        rows: 4,
        rowHeight: 36,
        columnWidths: ["7rem", "2rem", "4rem", "7rem", "9rem", "9rem"],
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
          <TableHead>Config</TableHead>
          <SortableTableHead
            label="Sunset"
            column="sunsetAfter"
            sort={sort}
            direction={direction}
            onSort={onSort}
          />
        </>
      )}
      renderRow={(version: VersionSummary) => {
        const contract = contractsByVersion.get(version.version);
        return (
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
              {contract ? (
                <VersionConfigSummary
                  endpointCount={contract.endpointCount}
                  modelCount={contract.modelCount}
                />
              ) : (
                <span className="text-[0.6875rem] text-muted-foreground">
                  {contracts.isLoading
                    ? "loading…"
                    : contracts.isError
                      ? "unavailable"
                      : "not uploaded"}
                </span>
              )}
            </TableCell>
            <TableCell>
              {version.sunsetAfter ? (
                <Badge variant="destructive">
                  sunset scheduled {version.sunsetAfter}
                </Badge>
              ) : null}
            </TableCell>
          </>
        );
      }}
      errorState="Version traffic is temporarily unavailable."
    />
  );
}
