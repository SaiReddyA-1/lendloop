import { describe, expect, it } from "vitest";
import { isIsoDate, todayUtc } from "./dates";

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
