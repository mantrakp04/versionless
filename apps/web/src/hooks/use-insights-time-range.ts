import { useCallback } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";

import {
  parseInsightsTimeRangeDays,
  type InsightsTimeRangeDays,
} from "@/components/insights/time-range-control";

const insightsRoute = getRouteApi("/insights/$projectId");

export function insightsTimeRangeNavigationOptions(
  nextDays: InsightsTimeRangeDays,
) {
  return {
    to: ".",
    search: (search: Record<string, unknown>) => ({
      ...search,
      days: nextDays,
    }),
    replace: true,
  } as const;
}

export function useInsightsTimeRange() {
  const searchDays = insightsRoute.useSearch({
    select: (search) => search.days,
  });
  const days = parseInsightsTimeRangeDays(searchDays);
  const navigate = useNavigate();
  const setDays = useCallback(
    (nextDays: InsightsTimeRangeDays) => {
      void navigate(insightsTimeRangeNavigationOptions(nextDays));
    },
    [navigate],
  );

  return [days, setDays] as const;
}
