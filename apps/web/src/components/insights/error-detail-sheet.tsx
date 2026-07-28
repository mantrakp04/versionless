import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Badge } from "@versionless/ui/components/badge";
import { Button } from "@versionless/ui/components/button";
import { Accordion } from "@versionless/ui/components/accordion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@versionless/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@versionless/ui/components/chart";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@versionless/ui/components/sheet";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { ArrowUpRight, CircleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ErrorOccurrenceRecord } from "@/components/insights/error-occurrence-record";
import { TelemetryOfflineState } from "@/components/insights/offline-card";
import {
  errorGroupHistoryQueryOptions,
  errorGroupOccurrencesQueryOptions,
  type RecentVersionErrorGroup,
} from "@/queries/errors";

const historyChartConfig = {
  errors: { label: "Occurrences", color: "var(--destructive)" },
} satisfies ChartConfig;

const emptyGroup: RecentVersionErrorGroup = {
  latestAt: "",
  version: "",
  route: "",
  status: 0,
  occurrences: 0,
  latestDurationMs: 0,
};

export function ErrorDetailSheet({
  days,
  group,
  onClose,
  onVersionClick,
  projectId,
}: {
  days: number;
  group: RecentVersionErrorGroup | null;
  onClose: () => void;
  onVersionClick: (version: string) => void;
  projectId: string;
}) {
  const selected = group ?? emptyGroup;
  const history = useQuery({
    ...errorGroupHistoryQueryOptions({
      projectId,
      days,
      version: selected.version,
      route: selected.route,
      status: selected.status,
    }),
    enabled: group !== null,
  });
  const occurrences = useInfiniteQuery({
    ...errorGroupOccurrencesQueryOptions({
      projectId,
      days,
      version: selected.version,
      route: selected.route,
      status: selected.status,
    }),
    enabled: group !== null,
  });
  const occurrenceItems = useMemo(
    () => occurrences.data?.pages.flatMap((page) => page.items) ?? [],
    [occurrences.data],
  );
  const occurrenceScrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [expandedOccurrences, setExpandedOccurrences] = useState<string[]>([]);
  const firstOccurrenceId = occurrenceItems[0]?.traceId;
  useEffect(() => {
    setExpandedOccurrences(firstOccurrenceId ? [firstOccurrenceId] : []);
  }, [firstOccurrenceId, group?.route, group?.status, group?.version]);
  useEffect(() => {
    const root = occurrenceScrollRef.current;
    const target = loadMoreRef.current;
    if (!root || !target || !occurrences.hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !occurrences.isFetchingNextPage) {
          void occurrences.fetchNextPage();
        }
      },
      { root, rootMargin: "240px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    occurrences.fetchNextPage,
    occurrences.hasNextPage,
    occurrences.isFetchingNextPage,
  ]);
  const error = history.error ?? occurrences.error;

  return (
    <Sheet
      open={group !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        blurOverlay={false}
        className="data-[side=right]:w-full data-[side=right]:sm:w-[min(46rem,calc(100vw-16rem))] data-[side=right]:sm:max-w-none"
        overlayClassName="bg-black/25"
      >
        <SheetHeader className="shrink-0 border-b p-5 pr-14">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="destructive">
              {selected.status >= 400 ? selected.status : "Error"}
            </Badge>
            <Button
              className="h-auto gap-1 p-0 font-mono text-xs"
              onClick={() => onVersionClick(selected.version)}
              variant="link"
            >
              {selected.version}
              <ArrowUpRight aria-hidden="true" className="size-3" />
            </Button>
            <SheetTitle className="min-w-0 flex-1 truncate font-mono text-base">
              {selected.route}
            </SheetTitle>
          </div>
        </SheetHeader>

        <div
          className="min-h-0 flex-1 overflow-y-auto p-5"
          ref={occurrenceScrollRef}
        >
          {error ? (
            <Card>
              <CardContent>
                <TelemetryOfflineState error={error} />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Occurrence history</CardTitle>
                  <CardDescription>
                    Failed requests per {days === 1 ? "hour" : "day"} in this
                    window.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {history.isLoading ? (
                    <Skeleton className="h-44 w-full" />
                  ) : (
                    <ChartContainer
                      className="aspect-auto h-44 w-full"
                      config={historyChartConfig}
                    >
                      <BarChart
                        data={history.data ?? []}
                        margin={{ left: -16, right: 12, top: 8 }}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis
                          axisLine={false}
                          dataKey="bucket"
                          minTickGap={24}
                          tickFormatter={(value: string) =>
                            days === 1
                              ? value.slice(11, 16)
                              : value.slice(5, 10)
                          }
                          tickLine={false}
                          tickMargin={9}
                        />
                        <YAxis
                          allowDecimals={false}
                          axisLine={false}
                          tickLine={false}
                        />
                        <ChartTooltip
                          content={<ChartTooltipContent indicator="line" />}
                        />
                        <Bar
                          dataKey="errors"
                          fill="var(--color-errors)"
                          maxBarSize={44}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <div className="flex items-end justify-between gap-4">
                <div>
                  <h3 className="font-heading text-sm font-medium">
                    Individual occurrences
                  </h3>
                  <p className="mt-1 text-muted-foreground">
                    Current SDKs trace every failed exchange. Counts still come
                    from request logs; this list shows the trace detail
                    available for those {selected.occurrences.toLocaleString()}{" "}
                    failures.
                  </p>
                </div>
                <Badge variant="secondary">
                  {occurrenceItems.length.toLocaleString()} captured
                </Badge>
              </div>

              {occurrences.isPending ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }, (_, index) => (
                    <Skeleton className="h-36 w-full" key={index} />
                  ))}
                </div>
              ) : occurrenceItems.length === 0 ? (
                <div className="grid min-h-36 place-items-center rounded-lg border border-dashed text-center">
                  <div>
                    <CircleAlert
                      aria-hidden="true"
                      className="mx-auto mb-2 size-5 text-muted-foreground"
                    />
                    <p className="font-medium">
                      No occurrence detail available
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      No trace was ingested for these failures. They may predate
                      error trace capture or come from a client with tracing
                      disabled.
                    </p>
                  </div>
                </div>
              ) : (
                <Accordion
                  className="bg-card"
                  onValueChange={setExpandedOccurrences}
                  value={expandedOccurrences}
                >
                  {occurrenceItems.map((occurrence, index) => (
                    <ErrorOccurrenceRecord
                      expanded={expandedOccurrences.includes(
                        occurrence.traceId,
                      )}
                      index={index}
                      key={occurrence.traceId}
                      occurrence={occurrence}
                      projectId={projectId}
                      signature={selected}
                    />
                  ))}
                  {occurrences.hasNextPage ? (
                    <div
                      aria-label="Load more occurrences"
                      className="px-4 py-3"
                      ref={loadMoreRef}
                      role="status"
                    >
                      {occurrences.isFetchingNextPage ? (
                        <Skeleton className="h-12 w-full" />
                      ) : (
                        <span className="sr-only">
                          More occurrences load while scrolling
                        </span>
                      )}
                    </div>
                  ) : null}
                </Accordion>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
