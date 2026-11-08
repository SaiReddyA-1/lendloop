import { differenceInCalendarDays, format, isValid, parseISO } from "date-fns";

/** Local calendar date as YYYY-MM-DD (server allows 1 day of tolerance, ADR-006). */
export function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function daysInclusive(start: string, end: string): number {
  return differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;
}

export function isValidIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));
}

function fmt(iso: string, withYear: boolean): string {
  const d = parseISO(iso);
  return isValid(d) ? format(d, withYear ? "MMM d, yyyy" : "MMM d") : iso;
}

/** "Nov 10 – Nov 12", "Nov 10" (single day), adds the year when it is not this year. */
export function formatRange(start: string, end: string): string {
  const thisYear = String(new Date().getFullYear());
  const withYear = !start.startsWith(thisYear) || !end.startsWith(thisYear);
  return start === end ? fmt(start, withYear) : `${fmt(start, withYear)} \u2013 ${fmt(end, withYear)}`;
}

/** "Nov 8, 2026, 14:05" from an epoch-ms timestamp (local time). */
export function formatDateTime(ts: number): string {
  return format(new Date(ts), "MMM d, yyyy, HH:mm");
}

/** "Nov 8, 2026" from an epoch-ms timestamp (local time). */
export function formatDay(ts: number): string {
  return format(new Date(ts), "MMM d, yyyy");
}
