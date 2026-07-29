import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@versionless/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@versionless/ui/components/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@versionless/ui/components/sheet";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { FileWarning } from "lucide-react";

import { VersionContractDetails } from "@/components/insights/version-contract-details";
import {
  RUNTIME_SECTION_COUNT,
  VersionRuntimeAnalytics,
} from "@/components/insights/version-runtime-analytics";
import type { InsightsTimeRangeDays } from "@/components/insights/time-range-control";
import { versionRouteAnalyticsQueryOptions } from "@/queries/insights";
import { clientErrorMessage } from "@/utils/client-error";
import { trpc } from "@/utils/trpc";

/** Mirrors the collapsed report: a lead paragraph over a stack of section rows. */
export function VersionSheetSkeleton() {
  return (
    <div role="status">
      <div className="space-y-2 pb-5">
        <Skeleton className="h-3.5 w-full max-w-[46rem]" />
        <Skeleton className="h-3.5 w-3/5 max-w-[28rem]" />
      </div>
      {Array.from({ length: 6 }, (_, index) => (
        <div className="flex items-start gap-4 border-b px-2 py-4" key={index}>
          <Skeleton className="mt-0.5 h-3 w-5 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-full max-w-[38rem]" />
            <div className="flex gap-6 pt-1">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        </div>
      ))}
      <span className="sr-only">Loading version details</span>
    </div>
  );
}

export function VersionDetailsSheet({
  days,
  onClose,
  projectId,
  version,
}: {
  days: InsightsTimeRangeDays;
  onClose: () => void;
  projectId: string;
  version: string | null;
}) {
  const contracts = useQuery({
    ...trpc.projects.versions.queryOptions({ projectId }),
    enabled: version !== null,
  });
  const detail = contracts.data?.find(
    (candidate) => candidate.version === version,
  );
  const endpointActivity = useQuery({
    ...versionRouteAnalyticsQueryOptions({
      projectId,
      version: version ?? "",
      days,
    }),
    enabled: version !== null,
  });

  return (
    <Sheet
      open={version !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        blurOverlay={false}
        className="data-[side=right]:w-full data-[side=right]:sm:w-[calc(100vw-16rem)] data-[side=right]:sm:max-w-5xl"
        overlayClassName="bg-black/25"
      >
        <SheetHeader className="shrink-0 border-b p-5 pr-14">
          <SheetTitle className="text-base">Version {version}</SheetTitle>
          <SheetDescription>
            Live usage first, followed by endpoints and technical details.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {contracts.isLoading ? (
            <VersionSheetSkeleton />
          ) : detail && contracts.data && version ? (
            <VersionContractDetails
              detail={detail}
              endpointActivity={endpointActivity.data}
              endpointActivityStatus={
                endpointActivity.isLoading
                  ? "loading"
                  : endpointActivity.isError
                    ? "unavailable"
                    : "ready"
              }
              versions={contracts.data}
              runtimeSectionCount={RUNTIME_SECTION_COUNT}
              runtime={
                <VersionRuntimeAnalytics
                  days={days}
                  projectId={projectId}
                  version={version}
                />
              }
            />
          ) : (
            <Card>
              <CardContent>
                <Empty className="border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FileWarning />
                    </EmptyMedia>
                    <EmptyTitle>Version unavailable</EmptyTitle>
                    <EmptyDescription className="max-w-lg whitespace-pre-line">
                      {contracts.isError
                        ? clientErrorMessage(
                            contracts.error,
                            "We could not load this version. Please try again shortly.",
                          )
                        : "No endpoint definition has been uploaded for this traffic version."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </CardContent>
            </Card>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
