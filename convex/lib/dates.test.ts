import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetweenInclusive,
  isIsoDate,
  isPastWithTolerance,
  rangesOverlap,
  todayUtc,
} from "./dates";

describe("todayUtc", () => {
  it("returns YYYY-MM-DD", () => {
    expect(todayUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("uses UTC, not local time", () => {
    expect(todayUtc(new Date("2026-11-08T23:59:59Z"))).toBe("2026-11-08");
  });
});

describe("isIsoDate", () => {
  it("accepts valid dates", () => {
    expect(isIsoDate("2026-11-08")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });
  it("rejects malformed or impossible dates", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "26-01-01", "2026-1-1", "", "2026-11-08T00:00:00Z"]) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });
});

describe("range helpers", () => {
  it("rangesOverlap is inclusive on both ends", () => {
    expect(rangesOverlap("2026-11-01", "2026-11-05", "2026-11-05", "2026-11-08")).toBe(true);
    expect(rangesOverlap("2026-11-05", "2026-11-08", "2026-11-01", "2026-11-05")).toBe(true);
    expect(rangesOverlap("2026-11-01", "2026-11-05", "2026-11-06", "2026-11-08")).toBe(false);
    expect(rangesOverlap("2026-11-01", "2026-11-30", "2026-11-10", "2026-11-11")).toBe(true);
  });
  it("rangesOverlap throws on invalid dates", () => {
    expect(() => rangesOverlap("2026-02-30", "2026-03-01", "2026-03-01", "2026-03-02")).toThrow();
  });
  it("daysBetweenInclusive counts both ends", () => {
    expect(daysBetweenInclusive("2026-11-01", "2026-11-01")).toBe(1);
    expect(daysBetweenInclusive("2026-11-01", "2026-11-30")).toBe(30);
    expect(daysBetweenInclusive("2026-02-27", "2026-03-02")).toBe(4);
  });
  it("addDays crosses month/year boundaries and leap days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2026-11-08", 0)).toBe("2026-11-08");
  });
  it("isPastWithTolerance allows yesterday, rejects two days ago", () => {
    expect(isPastWithTolerance("2026-11-08", "2026-11-08")).toBe(false);
    expect(isPastWithTolerance("2026-11-07", "2026-11-08")).toBe(false);
    expect(isPastWithTolerance("2026-11-06", "2026-11-08")).toBe(true);
  });
});
