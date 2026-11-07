import type { Doc } from "../_generated/dataModel";
import { appError } from "./errors";

export type LoanStatus = Doc<"loans">["status"];
export type LoanActor = "owner" | "borrower" | "admin" | "system";
export type DisplayStatus = LoanStatus | "active" | "overdue";

/**
 * The ONLY place that defines which loan transitions exist and who may
 * perform them. Authorization of *who the caller is* happens earlier
 * (requireLoanParty); this table guards the lifecycle itself.
 * Admins have no loan transitions (ADR: admins moderate tools, not loans).
 */
export const LOAN_TRANSITIONS: Readonly<
  Record<LoanStatus, Partial<Record<LoanStatus, readonly LoanActor[]>>>
> = {
  pending: {
    approved: ["owner"],
    declined: ["owner"],
    cancelled: ["borrower", "system"],
  },
  approved: { returned: ["owner"] },
  declined: {},
  cancelled: {},
  returned: {},
};

const MESSAGES: Record<LoanStatus, string> = {
  approved: "This request can no longer be approved.",
  declined: "This request can no longer be declined.",
  cancelled: "This request can no longer be cancelled.",
  returned: "This loan can't be marked as returned right now.",
  pending: "This request can't be changed.",
};

export function canTransition(from: LoanStatus, to: LoanStatus, actor: LoanActor): boolean {
  return LOAN_TRANSITIONS[from][to]?.includes(actor) ?? false;
}

/** Throws INVALID_TRANSITION unless `from -> to` is allowed for `actor`. */
export function assertTransition(from: LoanStatus, to: LoanStatus, actor: LoanActor): void {
  if (!canTransition(from, to, actor)) throw appError("INVALID_TRANSITION", MESSAGES[to]);
}

/** Display status derived from stored status + calendar dates (UTC `today`). */
export function deriveDisplayStatus(
  loan: Pick<Doc<"loans">, "status" | "startDate" | "endDate">,
  today: string,
): DisplayStatus {
  if (loan.status !== "approved") return loan.status;
  if (loan.endDate < today) return "overdue";
  if (loan.startDate <= today) return "active";
  return "approved";
}
