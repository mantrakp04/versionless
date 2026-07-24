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
