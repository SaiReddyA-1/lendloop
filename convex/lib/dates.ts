/** Calendar dates are stored as `YYYY-MM-DD` strings (no time zone). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in UTC as `YYYY-MM-DD`. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** True only for real calendar dates in strict `YYYY-MM-DD` form (rejects 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const DAY_MS = 86_400_000;

function toMs(iso: string): number {
  if (!isIsoDate(iso)) throw new Error("Invalid ISO date");
  return Date.parse(`${iso}T00:00:00.000Z`);
}

/** Inclusive overlap of two calendar-date ranges (touching end == start overlaps). */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMs(aStart) <= toMs(bEnd) && toMs(bStart) <= toMs(aEnd);
}

/** Number of calendar days in [start, end], both inclusive (same day = 1). */
export function daysBetweenInclusive(start: string, end: string): number {
  return Math.round((toMs(end) - toMs(start)) / DAY_MS) + 1;
}

/** Adds `n` (possibly negative) days to a `YYYY-MM-DD` date, in UTC. */
export function addDays(iso: string, n: number): string {
  return new Date(toMs(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** ADR-006: "past" means strictly before (today - 1 day), tolerating time-zone skew. */
export function isPastWithTolerance(iso: string, today: string): boolean {
  return toMs(iso) < toMs(addDays(today, -1));
}
