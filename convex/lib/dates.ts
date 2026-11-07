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
