import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireLoanParty, requireUser } from "./lib/auth";
import {
  daysBetweenInclusive,
  isIsoDate,
  isPastWithTolerance,
  rangesOverlap,
  todayUtc,
} from "./lib/dates";
import { appError } from "./lib/errors";
import { assertTransition, deriveDisplayStatus } from "./lib/loanStateMachine";
import { enqueueLoanEvent } from "./lib/notify";
import { categoryValidator, LIMITS, loanStatusValidator } from "./lib/validation";

const LIST_CAP = 100; // ADR: take() caps instead of pagination for now.
const HOUR_MS = 3_600_000;
const ALL_STATUSES = ["pending", "approved", "declined", "cancelled", "returned"] as const;

const displayStatusValidator = v.union(
  loanStatusValidator,
  v.literal("active"),
  v.literal("overdue"),
);

const myRequestValidator = v.object({
  _id: v.id("loans"),
  toolName: v.string(),
  toolCategory: categoryValidator,
  ownerName: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  status: loanStatusValidator,
  displayStatus: displayStatusValidator,
  createdAt: v.number(),
});

const incomingValidator = v.object({
  _id: v.id("loans"),
  toolName: v.string(),
  borrowerName: v.string(),
  borrowerTrustedLender: v.boolean(),
  startDate: v.string(),
  endDate: v.string(),
  status: loanStatusValidator,
  displayStatus: displayStatusValidator,
  createdAt: v.number(),
});

/** Per-request memo for related-row lookups (avoids repeated reads of the same tool/user). */
function relatedLoader(ctx: QueryCtx) {
  const tools = new Map<string, Promise<Doc<"tools"> | null>>();
  const users = new Map<string, Promise<Doc<"users"> | null>>();
  return {
    tool(id: Id<"tools">) {
      let p = tools.get(id);
      if (!p) tools.set(id, (p = ctx.db.get("tools", id)));
      return p;
    },
    user(id: Id<"users">) {
      let p = users.get(id);
      if (!p) users.set(id, (p = ctx.db.get("users", id)));
      return p;
    },
  };
}

/** Shared projection: the single place that decides which loan fields leave the server. */
async function projectLoan(
  loan: Doc<"loans">,
  related: ReturnType<typeof relatedLoader>,
  today: string,
) {
  const [tool, owner, borrower] = await Promise.all([
    related.tool(loan.toolId),
    related.user(loan.ownerId),
    related.user(loan.borrowerId),
  ]);
  return {
    _id: loan._id,
    toolName: tool?.name ?? "Removed tool",
    toolCategory: tool?.category ?? ("other" as const),
    ownerName: owner?.name ?? "Neighbor",
    borrowerName: borrower?.name ?? "Neighbor",
    borrowerTrustedLender: borrower?.trustedLender ?? false,
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    displayStatus: deriveDisplayStatus(loan, today),
    createdAt: loan.createdAt,
  };
}

async function approvedLoansFor(ctx: QueryCtx, toolId: Id<"tools">) {
  return ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .take(100);
}

// AUTH: requireUser. Borrower is the caller; owner derived from the tool, never from args. Rate limited (API4/API6).
export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  returns: v.id("loans"),
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const { startDate, endDate } = args;

    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      throw appError("VALIDATION", "Please choose valid dates.");
    }
    if (startDate > endDate) {
      throw appError("VALIDATION", "The end date must be on or after the start date.");
    }
    const now = Date.now();
    const today = todayUtc(new Date(now));
    if (isPastWithTolerance(startDate, today)) {
      throw appError("VALIDATION", "The start date can't be in the past.");
    }
    if (daysBetweenInclusive(startDate, endDate) > LIMITS.MAX_LOAN_DAYS) {
      throw appError("VALIDATION", `Loans can last at most ${LIMITS.MAX_LOAN_DAYS} days.`);
    }

    const tool = await ctx.db.get("tools", args.toolId);
    if (!tool || tool.status !== "active") {
      throw appError("NOT_FOUND", "We couldn't find that item.");
    }
    if (tool.ownerId === me._id) {
      throw appError("VALIDATION", "You can't borrow your own tool.");
    }

    const approved = await approvedLoansFor(ctx, tool._id);
    if (approved.some((l) => rangesOverlap(startDate, endDate, l.startDate, l.endDate))) {
      throw appError("CONFLICT", "That tool is already booked for some of those dates.");
    }

    // Caller's own pending requests: bounded read (limit + 1) serves duplicate + cap checks.
    const myPending = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id).eq("status", "pending"))
      .take(LIMITS.MAX_PENDING_PER_BORROWER + 1);
    if (
      myPending.some(
        (l) =>
          l.toolId === tool._id && rangesOverlap(startDate, endDate, l.startDate, l.endDate),
      )
    ) {
      throw appError("CONFLICT", "You already have a pending request for those dates.");
    }
    if (myPending.length >= LIMITS.MAX_PENDING_PER_BORROWER) {
      throw appError(
        "RATE_LIMITED",
        `You can have at most ${LIMITS.MAX_PENDING_PER_BORROWER} pending requests at once.`,
      );
    }
    const recent = await ctx.db
      .query("loans")
      .withIndex("by_borrower_created", (q) =>
        q.eq("borrowerId", me._id).gte("createdAt", now - HOUR_MS),
      )
      .take(LIMITS.MAX_REQUESTS_PER_HOUR);
    if (recent.length >= LIMITS.MAX_REQUESTS_PER_HOUR) {
      throw appError("RATE_LIMITED", "You're sending requests too quickly. Please try again later.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: me._id,
      startDate,
      endDate,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await enqueueLoanEvent(ctx, { loanId, type: "request_created", recipientRole: "owner" });
    return loanId;
  },
});

// AUTH: requireLoanParty (owner). Re-checks availability, then auto-declines overlapping pending requests (ADR-015).
export const approve = mutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { loan } = await requireLoanParty(ctx, args.loanId, "owner");
    assertTransition(loan.status, "approved", "owner");
    const tool = await ctx.db.get("tools", loan.toolId);
    if (!tool || tool.status !== "active") {
      throw appError("CONFLICT", "This tool is no longer available.");
    }
    const now = Date.now();
    if (isPastWithTolerance(loan.endDate, todayUtc(new Date(now)))) {
      throw appError("VALIDATION", "This request has expired.");
    }
    const approved = await approvedLoansFor(ctx, loan.toolId);
    if (approved.some((l) => rangesOverlap(loan.startDate, loan.endDate, l.startDate, l.endDate))) {
      throw appError("CONFLICT", "That tool is already booked for some of those dates.");
    }

    await ctx.db.patch("loans", loan._id, { status: "approved", decidedAt: now, updatedAt: now });
    await enqueueLoanEvent(ctx, {
      loanId: loan._id,
      type: "request_approved",
      recipientRole: "borrower",
    });

    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "pending"))
      .take(200);
    for (const other of pending) {
      if (other._id === loan._id) continue;
      if (!rangesOverlap(loan.startDate, loan.endDate, other.startDate, other.endDate)) continue;
      assertTransition(other.status, "declined", "owner");
      await ctx.db.patch("loans", other._id, { status: "declined", decidedAt: now, updatedAt: now });
      await enqueueLoanEvent(ctx, {
        loanId: other._id,
        type: "request_declined",
        recipientRole: "borrower",
      });
    }
    return null;
  },
});

// AUTH: requireLoanParty (owner).
export const decline = mutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { loan } = await requireLoanParty(ctx, args.loanId, "owner");
    assertTransition(loan.status, "declined", "owner");
    const now = Date.now();
    await ctx.db.patch("loans", loan._id, { status: "declined", decidedAt: now, updatedAt: now });
    await enqueueLoanEvent(ctx, {
      loanId: loan._id,
      type: "request_declined",
      recipientRole: "borrower",
    });
    return null;
  },
});

// AUTH: requireLoanParty (borrower).
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { loan } = await requireLoanParty(ctx, args.loanId, "borrower");
    assertTransition(loan.status, "cancelled", "borrower");
    await ctx.db.patch("loans", loan._id, { status: "cancelled", updatedAt: Date.now() });
    await enqueueLoanEvent(ctx, {
      loanId: loan._id,
      type: "request_cancelled",
      recipientRole: "owner",
    });
    return null;
  },
});

// AUTH: requireLoanParty (owner). Only the lender can confirm the tool is back (ADR-016).
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { loan } = await requireLoanParty(ctx, args.loanId, "owner");
    assertTransition(loan.status, "returned", "owner");
    const now = Date.now();
    await ctx.db.patch("loans", loan._id, { status: "returned", returnedAt: now, updatedAt: now });
    await enqueueLoanEvent(ctx, {
      loanId: loan._id,
      type: "loan_returned",
      recipientRole: "borrower",
    });
    return null;
  },
});

// AUTH: requireUser. Only loans where the caller is the borrower (derived from identity).
export const listMyRequests = query({
  args: {},
  returns: v.array(myRequestValidator),
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower_created", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .take(LIST_CAP);
    const today = todayUtc();
    const related = relatedLoader(ctx);
    return Promise.all(
      loans.map(async (l) => {
        const p = await projectLoan(l, related, today);
        return {
          _id: p._id,
          toolName: p.toolName,
          toolCategory: p.toolCategory,
          ownerName: p.ownerName,
          startDate: p.startDate,
          endDate: p.endDate,
          status: p.status,
          displayStatus: p.displayStatus,
          createdAt: p.createdAt,
        };
      }),
    );
  },
});

// AUTH: requireUser. Only loans on the caller's own tools; borrower name + trusted flag only (no email).
export const listIncoming = query({
  args: {},
  returns: v.array(incomingValidator),
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    // by_owner sorts by status first, so read each status (bounded) and merge by createdAt.
    const perStatus = await Promise.all(
      ALL_STATUSES.map((status) =>
        ctx.db
          .query("loans")
          .withIndex("by_owner", (q) => q.eq("ownerId", me._id).eq("status", status))
          .order("desc")
          .take(LIST_CAP),
      ),
    );
    const loans = perStatus
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, LIST_CAP);
    const today = todayUtc();
    const related = relatedLoader(ctx);
    return Promise.all(
      loans.map(async (l) => {
        const p = await projectLoan(l, related, today);
        return {
          _id: p._id,
          toolName: p.toolName,
          borrowerName: p.borrowerName,
          borrowerTrustedLender: p.borrowerTrustedLender,
          startDate: p.startDate,
          endDate: p.endDate,
          status: p.status,
          displayStatus: p.displayStatus,
          createdAt: p.createdAt,
        };
      }),
    );
  },
});
