import { describe, expect, it } from "vitest";
import { assertTransition, deriveDisplayStatus, type LoanActor, type LoanStatus } from "./loanStateMachine";

const STATUSES: LoanStatus[] = ["pending", "approved", "declined", "cancelled", "returned"];
const ACTORS: LoanActor[] = ["owner", "borrower", "admin", "system"];
const ALLOWED = new Set([
  "pending>approved:owner",
  "pending>declined:owner",
  "pending>cancelled:borrower",
  "pending>cancelled:system",
  "approved>returned:owner",
]);

describe("assertTransition matrix (every from x to x actor)", () => {
  for (const from of STATUSES)
    for (const to of STATUSES)
      for (const actor of ACTORS) {
        const ok = ALLOWED.has(`${from}>${to}:${actor}`);
        it(`${from} -> ${to} by ${actor}: ${ok ? "allowed" : "INVALID_TRANSITION"}`, () => {
          if (ok) expect(() => assertTransition(from, to, actor)).not.toThrow();
          else
            expect(() => assertTransition(from, to, actor)).toThrowError(
              expect.objectContaining({ data: expect.objectContaining({ code: "INVALID_TRANSITION" }) }),
            );
        });
      }

  it("uses a friendly message", () => {
    expect(() => assertTransition("declined", "approved", "owner")).toThrowError(
      expect.objectContaining({ data: { code: "INVALID_TRANSITION", message: "This request can no longer be approved." } }),
    );
  });
});

describe("deriveDisplayStatus", () => {
  const today = "2026-11-08";
  const mk = (status: LoanStatus, startDate: string, endDate: string) => ({ status, startDate, endDate });
  it("passes through non-approved statuses", () => {
    for (const s of ["pending", "declined", "cancelled", "returned"] as const)
      expect(deriveDisplayStatus(mk(s, "2026-01-01", "2026-01-02"), today)).toBe(s);
  });
  it("approved upcoming stays approved", () => {
    expect(deriveDisplayStatus(mk("approved", "2026-11-09", "2026-11-10"), today)).toBe("approved");
  });
  it("approved covering today (both edges) is active", () => {
    expect(deriveDisplayStatus(mk("approved", "2026-11-08", "2026-11-10"), today)).toBe("active");
    expect(deriveDisplayStatus(mk("approved", "2026-11-01", "2026-11-08"), today)).toBe("active");
  });
  it("approved with end before today is overdue", () => {
    expect(deriveDisplayStatus(mk("approved", "2026-11-01", "2026-11-07"), today)).toBe("overdue");
  });
});
