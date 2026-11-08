"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AutomationEvent } from "@/components/loans/automation-timeline";

const MAX_LOAN_IDS = 100; // server cap in automation.listForLoans

/**
 * ONE batched query for the visible loans. Returns `eventsFor(id)`:
 * undefined while loading, [] when there are none (or the loan is beyond the cap).
 */
export function useLoanAutomation(loans: { _id: Id<"loans"> }[] | undefined) {
  const loanIds = useMemo(
    () => (loans ? loans.slice(0, MAX_LOAN_IDS).map((l) => l._id) : undefined),
    [loans],
  );
  const result = useQuery(
    api.automation.listForLoans,
    loanIds && loanIds.length > 0 ? { loanIds } : "skip",
  );
  const known = useMemo(() => new Set(loanIds ?? []), [loanIds]);
  return (id: Id<"loans">): AutomationEvent[] | undefined => {
    if (!known.has(id)) return [];
    if (result === undefined) return undefined;
    return result[id] ?? [];
  };
}
