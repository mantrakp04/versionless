import { TRPCClientError } from "@trpc/client";
import { Card, CardContent } from "@versionless/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@versionless/ui/components/empty";
import { DatabaseZap } from "lucide-react";

import { clientErrorMessage } from "@/utils/client-error";
import { isProjectQueryUnavailable } from "@/utils/project-query";

/**
 * The insights procedures throw TRPCError PRECONDITION_FAILED when ClickHouse
 * is unconfigured or unreachable. On the client that surfaces as a
 * TRPCClientError whose `data.code` carries the error code.
 */
export function isTelemetryOffline(error: unknown): boolean {
  return (
    isProjectQueryUnavailable(error) ||
    (error instanceof TRPCClientError &&
      (error.data as { code?: string } | null | undefined)?.code ===
        "PRECONDITION_FAILED")
  );
}

export function OfflineCard({ error }: { error?: unknown }) {
  return (
    <Card>
      <CardContent>
        <TelemetryOfflineState error={error} />
      </CardContent>
    </Card>
  );
}

export function TelemetryOfflineState({ error }: { error?: unknown }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DatabaseZap />
        </EmptyMedia>
        <EmptyTitle>Insights temporarily unavailable</EmptyTitle>
        <EmptyDescription className="max-w-lg whitespace-pre-line">
          {clientErrorMessage(
            error,
            "We could not load telemetry data. Please try again shortly.",
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
