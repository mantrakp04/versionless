import type { ReactNode } from "react";

import { ProjectSwitcher } from "@/components/insights/project-switcher";
import { TimeRangeControl } from "@/components/insights/time-range-control";
import { useInsightsContext } from "@/hooks/use-insights-context";

interface InsightsPageProps {
  title: string;
  description: ReactNode;
  children: ReactNode;
  controls?: ReactNode;
  maxWidth?: "5xl" | "6xl";
  showTimeRange?: boolean;
}

export function InsightsPage({
  title,
  description,
  children,
  controls,
  maxWidth = "5xl",
  showTimeRange = true,
}: InsightsPageProps) {
  const { days, setDays } = useInsightsContext();
  const widthClass = maxWidth === "6xl" ? "max-w-6xl" : "max-w-5xl";

  return (
    <div
      className={`container mx-auto ${widthClass} space-y-6 overflow-y-auto px-4 py-6`}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-xl font-medium">{title}</h1>
          <div className="flex flex-wrap items-center gap-3">
            {showTimeRange ? (
              <TimeRangeControl value={days} onValueChange={setDays} />
            ) : null}
            {controls}
            <ProjectSwitcher />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
