import { Button } from "@versionless/ui/components/button";

export const INSIGHTS_TIME_RANGES = [
  { days: 1, label: "24h", description: "last 24 hours" },
  { days: 7, label: "7d", description: "last 7 days" },
  { days: 30, label: "30d", description: "last 30 days" },
] as const;

export type InsightsTimeRangeDays =
  (typeof INSIGHTS_TIME_RANGES)[number]["days"];

export const DEFAULT_INSIGHTS_TIME_RANGE_DAYS: InsightsTimeRangeDays = 30;

export function parseInsightsTimeRangeDays(
  value: unknown,
): InsightsTimeRangeDays {
  const days = typeof value === "string" ? Number(value) : value;
  return INSIGHTS_TIME_RANGES.some((range) => range.days === days)
    ? (days as InsightsTimeRangeDays)
    : DEFAULT_INSIGHTS_TIME_RANGE_DAYS;
}

interface TimeRangeControlProps {
  value: InsightsTimeRangeDays;
  onValueChange: (value: InsightsTimeRangeDays) => void;
  "aria-label"?: string;
}

export function TimeRangeControl({
  value,
  onValueChange,
  "aria-label": ariaLabel = "Time range",
}: TimeRangeControlProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center rounded-lg border bg-muted/40 p-0.5"
    >
      {INSIGHTS_TIME_RANGES.map((range) => (
        <Button
          key={range.days}
          type="button"
          size="sm"
          variant={value === range.days ? "secondary" : "ghost"}
          className="w-10 flex-none justify-center rounded-md px-0 text-center leading-none tabular-nums"
          aria-pressed={value === range.days}
          onClick={() => onValueChange(range.days)}
        >
          {range.label}
        </Button>
      ))}
    </div>
  );
}
