import { describe, expect, it } from "vitest";
import { CATEGORIES, LIMITS, assertLength, sanitizeText } from "./validation";

describe("sanitizeText", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeText("  a \t\n  b   c ")).toBe("a b c");
  });
  it("strips control characters", () => {
    expect(sanitizeText("he\u0000llo\u0007 wor\u001Bld\u007F")).toBe("he llo wor ld");
    expect(sanitizeText("a\u0085b")).toBe("a b");
  });
  it("strips zero-width, bidi and BOM format characters", () => {
    expect(sanitizeText("a​b‎c‮d⁦e⁠f﻿g")).toBe("abcdefg");
    expect(sanitizeText("‮gnp.exe")).toBe("gnp.exe");
  });
  it("keeps unicode letters and emoji", () => {
    expect(sanitizeText("  Zoë ✓ ")).toBe("Zoë ✓");
  });
  it("returns empty for whitespace/control-only input", () => {
    expect(sanitizeText(" \u0000 \n ")).toBe("");
  });
});

describe("assertLength", () => {
  it("returns the trimmed value within bounds", () => {
    expect(assertLength("Name", "  ab  ", 2, 80)).toBe("ab");
  });
  it("throws VALIDATION when too short (after trim) or too long", () => {
    expect(() => assertLength("Name", " a ", 2, 80)).toThrowError(/Name must be between 2 and 80/);
    try {
      assertLength("Name", "x".repeat(81), 2, 80);
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ data: { code: "VALIDATION" } });
    }
  });
  it("supports min 0 for optional text", () => {
    expect(assertLength("Description", "", 0, 500)).toBe("");
    expect(() => assertLength("Description", "x".repeat(501), 0, 500)).toThrowError(/at most 500/);
  });
});

describe("constants", () => {
  it("exposes agreed limits and categories", () => {
    expect(LIMITS.MAX_LOAN_DAYS).toBe(30);
    expect(LIMITS.MAX_PENDING_PER_BORROWER).toBe(5);
    expect(LIMITS.MAX_REQUESTS_PER_HOUR).toBe(10);
    expect(CATEGORIES.map((c) => c.value)).toContain("power_tools");
  });
});
