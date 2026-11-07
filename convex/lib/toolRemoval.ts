import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertTransition } from "./loanStateMachine";
import { enqueueLoanEvent } from "./notify";

/**
 * Soft-deletes a tool and cancels its pending requests (actor "system").
 * Callers MUST have authorized the removal and checked there is no live
 * approved loan. Phase 5 admin removal reuses this and adds an audit row.
 */
export async function removeToolAndCancelPending(
  ctx: MutationCtx,
  tool: Doc<"tools">,
  removedBy: Doc<"users">["_id"],
): Promise<{ cancelledLoans: number }> {
  const now = Date.now();
  await ctx.db.patch("tools", tool._id, {
    status: "removed",
    removedAt: now,
    removedBy,
    updatedAt: now,
  });
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
    .take(500);
  for (const loan of pending) {
    assertTransition(loan.status, "cancelled", "system");
    await ctx.db.patch("loans", loan._id, { status: "cancelled", updatedAt: now });
    await enqueueLoanEvent(ctx, {
      loanId: loan._id,
      type: "request_cancelled",
      recipientRole: "borrower",
    });
  }
  return { cancelledLoans: pending.length };
}
