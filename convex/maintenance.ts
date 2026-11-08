import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { declineOverlappingPending } from "./lib/autoDecline";
import { cancelPendingForTool } from "./lib/toolRemoval";

/** Events stuck in `pending` (no scheduled retry in the future) longer than this are re-driven. */
export const STUCK_AFTER_MS = 10 * 60_000;
const SWEEP_BATCH = 100;

/**
 * Continuation of a tool removal whose pending-request backlog exceeded one transaction (L8).
 * Only acts on tools that are already removed.
 */
export const continueToolRemoval = internalMutation({
  args: { toolId: v.id("tools") },
  returns: v.null(),
  handler: async (ctx, { toolId }) => {
    const tool = await ctx.db.get("tools", toolId);
    if (!tool || tool.status !== "removed") return null;
    const { hasMore } = await cancelPendingForTool(ctx, toolId);
    if (hasMore) await ctx.scheduler.runAfter(0, internal.maintenance.continueToolRemoval, { toolId });
    return null;
  },
});

/** Continuation of approve's auto-decline when more than one batch of pending requests exists (L8). */
export const continueAutoDecline = internalMutation({
  args: { loanId: v.id("loans"), afterCreationTime: v.number() },
  returns: v.null(),
  handler: async (ctx, { loanId, afterCreationTime }) => {
    const loan = await ctx.db.get("loans", loanId);
    if (!loan || loan.status !== "approved") return null;
    const { nextAfter } = await declineOverlappingPending(ctx, loan, afterCreationTime);
    if (nextAfter !== null) {
      await ctx.scheduler.runAfter(0, internal.maintenance.continueAutoDecline, {
        loanId,
        afterCreationTime: nextAfter,
      });
    }
    return null;
  },
});

/**
 * Cron sweeper (see crons.ts): re-schedules `notifications.deliver` for outbox events that are still `pending`
 * with `updatedAt` older than STUCK_AFTER_MS and no retry scheduled in the future (e.g. the scheduled function
 * was lost, or the action crashed before scheduling the retry). Bounded to SWEEP_BATCH rows per run. Touching
 * `updatedAt` keeps a swept row out of the next run's window; `deliver` itself caps total attempts.
 */
export const sweepStuckEvents = internalMutation({
  args: {},
  returns: v.object({ rescheduled: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const stuck = await ctx.db
      .query("automationEvents")
      .withIndex("by_status_updatedAt", (q) =>
        q.eq("status", "pending").lt("updatedAt", now - STUCK_AFTER_MS),
      )
      .take(SWEEP_BATCH);
    let rescheduled = 0;
    for (const event of stuck) {
      if (event.nextAttemptAt !== undefined && event.nextAttemptAt > now) continue;
      await ctx.db.patch("automationEvents", event._id, { updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId: event._id });
      rescheduled++;
    }
    return { rescheduled };
  },
});
