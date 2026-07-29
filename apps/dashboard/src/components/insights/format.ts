import { formatDistanceToNow } from "date-fns";

/**
 * ClickHouse timestamps come back as "YYYY-MM-DD HH:MM:SS" (UTC). Normalize
 * to an ISO string so Date parsing is reliable across engines.
 */
export function parseTimestamp(value: string): Date | null {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Relative time like "3 days ago"; falls back to the raw string if unparseable. */
export function relativeTime(value: string): string {
  const date = parseTimestamp(value);
  return date ? formatDistanceToNow(date, { addSuffix: true }) : value;
}

/** "8.4K" past a thousand, plain digits below it. */
export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

/** "endpoint"/"endpoints" without an `s` bolted onto an irregular noun. */
export function plural(count: number, singular: string, pluralForm?: string) {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

/**
 * A share as a percentage. Sub-percent values keep a digit rather than
 * rounding to "0%", because a 0.4% error rate and a zero error rate are
 * different answers to the question the reader is asking.
 */
export function formatPercent(share: number, options: { digits?: number } = {}) {
  const percent = share * 100;
  if (percent > 0 && percent < 0.01) return "<0.01%";
  const digits =
    options.digits ?? (percent > 0 && percent < 1 ? 2 : percent < 10 ? 1 : 0);
  return `${percent.toFixed(digits)}%`;
}

/** Milliseconds, switching to seconds once "1240 ms" stops being readable. */
export function formatMs(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} s`;
  return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}
