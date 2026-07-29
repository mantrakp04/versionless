import { useQuery } from "@tanstack/react-query";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@versionless/ui/components/accordion";

import {
  TraceWaterfall,
  TraceWaterfallSkeleton,
} from "@/components/insights/trace-waterfall";
import {
  errorOccurrenceDetailQueryOptions,
  type ErrorGroupSignature,
  type ErrorOccurrence,
} from "@/queries/errors";
import { clientErrorMessage } from "@/utils/client-error";

import { relativeTime } from "./format";

function formatDuration(value: number): string {
  if (value < 1_000) return `${value.toFixed(0)} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

export function ErrorOccurrenceRecord({
  expanded,
  occurrence,
  index,
  projectId,
  signature,
}: {
  expanded: boolean;
  occurrence: ErrorOccurrence;
  index: number;
  projectId: string;
  signature: ErrorGroupSignature;
}) {
  const detail = useQuery({
    ...errorOccurrenceDetailQueryOptions({
      projectId,
      occurrence,
      ...signature,
    }),
    enabled: expanded,
  });
  const spans = detail.data?.spans ?? [];
  const log = detail.data?.log ?? null;
  const rootSpanId =
    spans.find((span) => span.name === "versionless.exchange")?.spanId ??
    spans[0]?.spanId;

  return (
    <AccordionItem value={occurrence.traceId}>
      <AccordionTrigger className="items-center px-4 py-3 hover:no-underline">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-4 pr-2">
          <div className="min-w-0">
            <div className="font-medium">Occurrence {index + 1}</div>
            <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">
              {relativeTime(occurrence.ts)}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono tabular-nums">
              {formatDuration(occurrence.durationMs)}
            </div>
            <div className="mt-0.5 max-w-36 truncate font-mono text-[0.625rem] text-muted-foreground">
              {occurrence.traceId}
            </div>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pt-2">
        {detail.isPending ? (
          <TraceWaterfallSkeleton label="Loading occurrence detail" />
        ) : detail.error ? (
          <p className="py-4 text-center text-xs text-destructive">
            {clientErrorMessage(
              detail.error,
              "Occurrence detail could not be loaded.",
            )}
          </p>
        ) : (
          <TraceWaterfall
            emptyState="No span detail is available for this occurrence."
            events={
              log
                ? [
                    {
                      id: `${occurrence.traceId}:request-log`,
                      name: log.eventName,
                      startMs: log.startMs,
                      severity: log.severity,
                      errorBody: log.errorBody,
                      parentSpanId: rootSpanId ?? null,
                      attrs: log.attrs,
                    },
                  ]
                : []
            }
            spans={spans}
          />
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
