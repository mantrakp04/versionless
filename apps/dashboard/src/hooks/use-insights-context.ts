import { createContext, useContext } from "react";

import type { InsightsTimeRangeDays } from "@/components/insights/time-range-control";
import type { useTelemetryProject } from "@/hooks/use-telemetry-project";

type TelemetryProjectState = ReturnType<typeof useTelemetryProject>;

export interface InsightsContextValue
  extends Omit<
    TelemetryProjectState,
    "projectsLoading" | "telemetryProject"
  > {
  project: NonNullable<TelemetryProjectState["telemetryProject"]>;
  days: InsightsTimeRangeDays;
  setDays: (days: InsightsTimeRangeDays) => void;
}

export const InsightsContext = createContext<InsightsContextValue | null>(null);

export function useInsightsContext(): InsightsContextValue {
  const context = useContext(InsightsContext);
  if (!context) {
    throw new Error("useInsightsContext must be used inside the insights route");
  }
  return context;
}
