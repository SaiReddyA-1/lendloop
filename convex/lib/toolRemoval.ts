import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertTransition } from "./loanStateMachine";
import { enqueueLoanEvent } from "./notify";

/**
 * Max loans one transaction cancels/declines in bulk. Each loan costs ~3 writes (patch, outbox row, scheduled
 * function) and Convex caps a mutation at 8192 writes, so 1000 leaves ample headroom. Anything beyond is handled
 * by a scheduled continuation (convex/maintenance.ts), so large backlogs finish in a chain of bounded mutations.
 */
export const BULK_BATCH_SIZE = 1000;

/**
 * Cancels up to `limit` pending requests on a tool (actor "system", borrowers notified via outbox).
 * `hasMore` is true when more pending rows remain; the caller must schedule a continuation.
 */
export async function cancelPendingForTool(
  ctx: MutationCtx,
  toolId: Id<"tools">,
  limit: number = BULK_BATCH_SIZE,
): Promise<{ cancelled: number; hasMore: boolean }> {
  const now = Date.now();
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
    .take(limit + 1);
  const batch = pending.slice(0, limit);
  for (const loan of batch) {
    assertTransition(loan.status, "cancelled", "system");
    await ctx.db.patch("loans", loan._id, { status: "cancelled", updatedAt: now });
    await enqueueLoanEvent(ctx, {
      loanId: loan._id,
      type: "request_cancelled",
      recipientRole: "borrower",
    });
  }
  return { cancelled: batch.length, hasMore: pending.length > limit };
}

/**
 * Soft-deletes a tool and cancels its pending requests (actor "system").
 * Callers MUST have authorized the removal and checked there is no live
 * approved loan. Phase 5 admin removal reuses this and adds an audit row.
 * `cancelledLoans` counts the first batch only; a continuation cancels the rest (L8).
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
    // The photo belongs to the active listing; drop the file so removed tools keep no uploaded media.
    photoId: undefined,
    updatedAt: now,
  });
  if (tool.photoId) await ctx.storage.delete(tool.photoId);
  const { cancelled, hasMore } = await cancelPendingForTool(ctx, tool._id);
  if (hasMore) {
    await ctx.scheduler.runAfter(0, internal.maintenance.continueToolRemoval, { toolId: tool._id });
  }
  return { cancelledLoans: cancelled };
}
