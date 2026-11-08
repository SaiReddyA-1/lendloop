import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { rangesOverlap } from "./dates";
import { assertTransition } from "./loanStateMachine";
import { BULK_BATCH_SIZE } from "./toolRemoval";
import { enqueueLoanEvent } from "./notify";

/**
 * After a loan is approved, auto-declines the OTHER pending requests on the same tool whose dates overlap (ADR-014).
 * Scans at most `limit` pending rows with `_creationTime > afterCreationTime` (oldest first). When more rows
 * remain, `nextAfter` is the cursor for a continuation (see `internal.maintenance.continueAutoDecline`).
 */
export async function declineOverlappingPending(
  ctx: MutationCtx,
  approved: Doc<"loans">,
  afterCreationTime = 0,
  limit: number = BULK_BATCH_SIZE,
): Promise<{ declined: number; nextAfter: number | null }> {
  const now = Date.now();
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) =>
      q.eq("toolId", approved.toolId).eq("status", "pending").gt("_creationTime", afterCreationTime),
    )
    .take(limit + 1);
  const batch = pending.slice(0, limit);
  let declined = 0;
  for (const other of batch) {
    if (other._id === approved._id) continue;
    if (!rangesOverlap(approved.startDate, approved.endDate, other.startDate, other.endDate)) continue;
    assertTransition(other.status, "declined", "owner");
    await ctx.db.patch("loans", other._id, { status: "declined", decidedAt: now, updatedAt: now });
    await enqueueLoanEvent(ctx, {
      loanId: other._id,
      type: "request_declined",
      recipientRole: "borrower",
    });
    declined++;
  }
  const last = batch[batch.length - 1];
  return {
    declined,
    nextAfter: pending.length > limit && last ? last._creationTime : null,
  };
}
