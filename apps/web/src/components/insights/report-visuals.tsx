import { cn } from "@versionless/ui/lib/utils";

/**
 * Small, label-free visuals for collapsed report rows. They carry shape only —
 * the exact numbers live in the row's hero metric and in the expanded panel.
 */

export function Sparkline({
  values,
  className,
  color = "var(--chart-1)",
}: {
  values: number[];
  className?: string;
  color?: string;
}) {
  const series = values.length === 1 ? [values[0]!, values[0]!] : values;
  if (series.length === 0) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(max - min, 1);
  const points = series.map((value, index) => {
    const x = (index / Math.max(series.length - 1, 1)) * 92 + 2;
    const y = 22 - ((value - min) / range) * 18;
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const last = points.at(-1)!;

  return (
    <svg
      aria-hidden="true"
      className={cn("h-6 w-24 overflow-visible", className)}
      viewBox="0 0 96 26"
    >
      <polyline
        fill="none"
        points={line}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
      <circle cx={last[0]} cy={last[1]} fill={color} r="2.25" />
    </svg>
  );
}

export function SplitBar({
  segments,
  className,
}: {
  segments: Array<{ value: number; color: string }>;
  className?: string;
}) {
  const total = Math.max(
    segments.reduce((sum, segment) => sum + segment.value, 0),
    1,
  );

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-1.5 w-24 overflow-hidden rounded-full bg-muted",
        className,
      )}
    >
      {segments.map((segment, index) => (
        <span
          className="h-full"
          key={index}
          style={{
            backgroundColor: segment.color,
            width: `${(segment.value / total) * 100}%`,
          }}
        />
      ))}
    </span>
  );
}

export function MiniBars({
  values,
  className,
  color = "var(--chart-1)",
}: {
  values: number[];
  className?: string;
  color?: string;
}) {
  const series = values.slice(0, 10);
  if (series.length === 0) return null;
  const max = Math.max(...series, 1);

  return (
    <span
      aria-hidden="true"
      className={cn("flex h-6 w-24 items-end gap-0.5", className)}
    >
      {series.map((value, index) => (
        <span
          className="min-w-0 flex-1 rounded-[1px]"
          key={index}
          style={{
            backgroundColor: color,
            height: `${Math.max((value / max) * 100, 8)}%`,
            opacity: 0.45 + (value / max) * 0.55,
          }}
        />
      ))}
    </span>
  );
}
