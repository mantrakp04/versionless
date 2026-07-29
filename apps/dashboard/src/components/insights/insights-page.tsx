import { cn } from "@versionless/ui/lib/utils";
import type { ReactNode } from "react";

import { ProjectSwitcher } from "@/components/insights/project-switcher";
import { TimeRangeControl } from "@/components/insights/time-range-control";
import { useInsightsContext } from "@/hooks/use-insights-context";

interface InsightsPageProps {
  title: string;
  children: ReactNode;
  controls?: ReactNode;
  className?: string;
  showTimeRange?: boolean;
}

export function InsightsPage({
  title,
  children,
  controls,
  className,
  showTimeRange = true,
}: InsightsPageProps) {
  const { days, setDays } = useInsightsContext();

  return (
    <div
      className={cn(
        "container mx-auto max-w-6xl space-y-6 px-4 py-4",
        className,
      )}
    >
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
      {children}
    </div>
  );
}
