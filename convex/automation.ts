import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireUser } from "./lib/auth";
import { daysBetweenInclusive, isIsoDate, todayUtc } from "./lib/dates";
import { appError } from "./lib/errors";
import {
  automationEventTypeValidator,
  automationStatusValidator,
  reminderOutcomeValidator,
  sanitizeText,
} from "./lib/validation";

const MAX_LOAN_IDS = 100;
const EVENTS_PER_LOAN = 5;
const OVERDUE_CAP = 100;

const eventItemValidator = v.object({
  type: automationEventTypeValidator,
  status: automationStatusValidator,
  attempts: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

// AUTH: requireUser + per-loan party filter (owner/borrower/admin); foreign loans are silently omitted (no existence leak).
export const listForLoans = query({
  args: { loanIds: v.array(v.id("loans")) },
  returns: v.record(v.id("loans"), v.array(eventItemValidator)),
  handler: async (ctx, { loanIds }) => {
    const me = await requireUser(ctx);
    if (loanIds.length > MAX_LOAN_IDS) {
      throw appError("VALIDATION", `Too many loans requested (max ${MAX_LOAN_IDS}).`);
    }
    const projected: Record<
      Id<"loans">,
      {
        type: Doc<"automationEvents">["type"];
        status: Doc<"automationEvents">["status"];
        attempts: number;
        createdAt: number;
        updatedAt: number;
      }[]
    > = {};
    for (const loanId of new Set(loanIds)) {
      const loan = await ctx.db.get("loans", loanId);
      if (!loan) continue;
      const isParty = loan.ownerId === me._id || loan.borrowerId === me._id;
      if (!isParty && me.role !== "admin") continue;
      const events = await ctx.db
        .query("automationEvents")
        .withIndex("by_loan", (q) => q.eq("loanId", loanId))
        .order("desc")
        .take(EVENTS_PER_LOAN);
      projected[loanId] = events.map((e) => ({
        type: e.type,
        status: e.status,
        attempts: e.attempts,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      }));
    }
    return projected;
  },
});

/** Approved loans past their end date that have no reminder row for today yet. Reminder-minimal fields only. */
export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx) => {
    const date = todayUtc();
    const approved = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", date))
      .take(OVERDUE_CAP * 2);
    const loans: {
      loanId: string;
      toolName: string;
      borrowerName: string;
      borrowerEmail: string;
      endDate: string;
      daysOverdue: number;
      idempotencyKey: string;
    }[] = [];
    for (const loan of approved) {
      if (loans.length >= OVERDUE_CAP) break;
      const idempotencyKey = `${loan._id}:${date}`;
      const existing = await ctx.db
        .query("reminders")
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
        .first();
      if (existing) continue;
      const [tool, borrower] = await Promise.all([
        ctx.db.get("tools", loan.toolId),
        ctx.db.get("users", loan.borrowerId),
      ]);
      if (!borrower?.email) continue;
      loans.push({
        loanId: loan._id,
        toolName: tool?.name ?? "Removed tool",
        borrowerName: borrower.name,
        borrowerEmail: borrower.email,
        endDate: loan.endDate,
        daysOverdue: daysBetweenInclusive(loan.endDate, date) - 1,
        idempotencyKey,
      });
    }
    return { date, loans };
  },
});

/** Records an overdue reminder outcome. Idempotency key is computed server-side. */
export const recordReminder = internalMutation({
  args: { loanId: v.string(), reminderDate: v.string(), outcome: reminderOutcomeValidator },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (!loanId || !isIsoDate(args.reminderDate)) return { status: "invalid" as const };
    const loan = await ctx.db.get("loans", loanId);
    if (!loan) return { status: "not_found" as const };
    if (loan.status !== "approved") return { status: "conflict" as const };
    const idempotencyKey = `${loanId}:${args.reminderDate}`;
    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();
    if (existing) return { status: "duplicate" as const };
    const now = Date.now();
    await ctx.db.insert("reminders", {
      idempotencyKey,
      loanId,
      reminderDate: args.reminderDate,
      outcome: args.outcome,
      createdAt: now,
    });
    await ctx.db.insert("automationEvents", {
      loanId,
      type: "overdue_reminder",
      recipientRole: "borrower",
      status: args.outcome === "sent" ? "delivered" : "failed",
      attempts: 1,
      ...(args.outcome === "failed" ? { lastErrorCode: "REMINDER_FAILED" } : {}),
      ...(args.outcome === "sent" ? { deliveredAt: now } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return { status: "recorded" as const };
  },
});

const EMAIL_RE = /[^\s@<>"']+@[^\s@<>"']+/g;

function clean(value: string, max: number): string {
  return sanitizeText(value).replace(EMAIL_RE, "[email]").slice(0, max);
}

/** Error-workflow write-back from n8n. Everything is sanitized, email-redacted and truncated. */
export const recordWorkflowError = internalMutation({
  args: {
    workflowName: v.string(),
    executionId: v.string(),
    nodeName: v.optional(v.string()),
    message: v.string(),
    loanId: v.optional(v.string()),
    eventId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let loanId = args.loanId ? ctx.db.normalizeId("loans", args.loanId) : null;
    const eventId = args.eventId ? ctx.db.normalizeId("automationEvents", args.eventId) : null;
    const event = eventId ? await ctx.db.get("automationEvents", eventId) : null;
    if (!loanId && event) loanId = event.loanId;
    if (loanId && !(await ctx.db.get("loans", loanId))) loanId = null;

    const nodeName = args.nodeName ? clean(args.nodeName, 100) : "";
    await ctx.db.insert("workflowErrors", {
      workflowName: clean(args.workflowName, 100),
      executionId: clean(args.executionId, 64),
      ...(nodeName ? { nodeName } : {}),
      message: clean(args.message, 300),
      ...(loanId ? { loanId } : {}),
      createdAt: now,
    });

    if (event && eventId && event.status !== "delivered") {
      await ctx.db.patch("automationEvents", eventId, {
        status: "failed",
        lastErrorCode: "WORKFLOW_ERROR",
        nextAttemptAt: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("automationEvents", {
        loanId: event.loanId,
        type: "workflow_error",
        recipientRole: "admin",
        status: "failed",
        attempts: 0,
        lastErrorCode: "WORKFLOW_ERROR",
        createdAt: now,
        updatedAt: now,
      });
    }
    return { status: "recorded" as const };
  },
});
