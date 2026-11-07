import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Transactional outbox (phase-3 stub). Every loan state change MUST call this
 * in the same mutation, so the event is committed atomically with the change.
 * Rows carry ids only (no PII); delivery resolves recipients at send time.
 */
export async function enqueueLoanEvent(
  ctx: MutationCtx,
  args: {
    loanId: Id<"loans">;
    type: Doc<"automationEvents">["type"];
    recipientRole: Doc<"automationEvents">["recipientRole"];
  },
): Promise<Id<"automationEvents">> {
  const now = Date.now();
  const id = await ctx.db.insert("automationEvents", {
    loanId: args.loanId,
    type: args.type,
    recipientRole: args.recipientRole,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  // PHASE 6: schedule internal delivery action here (ctx.scheduler.runAfter(0, internal....deliver, { eventId: id }))
  return id;
}
