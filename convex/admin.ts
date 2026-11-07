import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAdmin } from "./lib/auth";
import { todayUtc } from "./lib/dates";
import { appError } from "./lib/errors";
import { deriveDisplayStatus } from "./lib/loanStateMachine";
import { removeToolAndCancelPending } from "./lib/toolRemoval";
import {
  assertLength,
  auditActionValidator,
  auditTargetTypeValidator,
  categoryValidator,
  LIMITS,
  loanStatusValidator,
  roleValidator,
  sanitizeText,
  toolStatusValidator,
} from "./lib/validation";

const LIST_CAP = 200;
const AUDIT_DEFAULT = 50;
const AUDIT_MAX = 100;
const ERRORS_CAP = 100;
const FALLBACK_NAME = "Unknown";

// Operator-only (internal): not reachable from clients. Usage:
//   npx convex run admin:promoteToAdmin '{"clerkUserId":"user_...","reason":"bootstrap"}'
//   npx convex run admin:demoteToUser   '{"clerkUserId":"user_..."}'
// The target user must have signed in once (row created by users:ensureCurrent).

async function setRole(
  ctx: MutationCtx,
  clerkUserId: string,
  role: "admin" | "user",
  reason: string | undefined,
) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
    .unique();
  if (!user) throw appError("NOT_FOUND", "No user with that Clerk id has signed in yet.");
  if (user.role === role) return { changed: false };
  await ctx.db.patch("users", user._id, { role, updatedAt: Date.now() });
  await writeAudit(ctx, {
    actor: "system:cli",
    action: role === "admin" ? "user.role.promote" : "user.role.demote",
    targetType: "user",
    targetId: user._id,
    reason,
  });
  return { changed: true };
}

export const promoteToAdmin = internalMutation({
  args: { clerkUserId: v.string(), reason: v.optional(v.string()) },
  handler: (ctx, { clerkUserId, reason }) => setRole(ctx, clerkUserId, "admin", reason),
});

export const demoteToUser = internalMutation({
  args: { clerkUserId: v.string(), reason: v.optional(v.string()) },
  handler: (ctx, { clerkUserId, reason }) => setRole(ctx, clerkUserId, "user", reason),
});

// ---------------------------------------------------------------------------
// Moderation API (admin only). Every function calls requireAdmin first.
// ---------------------------------------------------------------------------

// AUTH: requireAdmin. Removes any user's tool: cancels PENDING requests (borrowers notified via outbox).
// APPROVED loans are deliberately NOT cancelled: the borrower may physically hold the tool (ADR-022).
export const removeTool = mutation({
  args: { toolId: v.id("tools"), reason: v.string() },
  returns: v.object({ cancelledLoans: v.number() }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const reason = assertLength("Reason", sanitizeText(args.reason), 3, LIMITS.REASON_MAX);
    const tool = await ctx.db.get("tools", args.toolId);
    if (!tool) throw appError("NOT_FOUND", "We could not find that item.");
    if (tool.status === "removed") throw appError("CONFLICT", "That tool was already removed.");
    const { cancelledLoans } = await removeToolAndCancelPending(ctx, tool, admin._id);
    await writeAudit(ctx, {
      actor: admin,
      action: "tool.remove",
      targetType: "tool",
      targetId: tool._id,
      reason,
    });
    return { cancelledLoans };
  },
});

// AUTH: requireAdmin. Admins cannot change their OWN trusted status (conflict of interest, ADR-023).
export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean(), reason: v.optional(v.string()) },
  returns: v.object({ changed: v.boolean() }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.userId === admin._id) {
      throw appError("FORBIDDEN", "You cannot change your own trusted status.");
    }
    const reason =
      args.reason === undefined
        ? undefined
        : assertLength("Reason", sanitizeText(args.reason), 0, LIMITS.REASON_MAX);
    const target = await ctx.db.get("users", args.userId);
    if (!target) throw appError("NOT_FOUND", "We could not find that item.");
    if (target.trustedLender === args.trusted) return { changed: false };
    await ctx.db.patch("users", target._id, { trustedLender: args.trusted, updatedAt: Date.now() });
    await writeAudit(ctx, {
      actor: admin,
      action: args.trusted ? "user.trusted.grant" : "user.trusted.revoke",
      targetType: "user",
      targetId: target._id,
      reason,
    });
    return { changed: true };
  },
});

// AUTH: requireAdmin. Projection excludes email, clerk ids and tokenIdentifier.
export const listUsers = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("users"),
      name: v.string(),
      role: roleValidator,
      trustedLender: v.boolean(),
      createdAt: v.number(),
      activeToolCount: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(LIST_CAP);
    return Promise.all(
      users.map(async (u) => {
        const active = await ctx.db
          .query("tools")
          .withIndex("by_owner", (q) => q.eq("ownerId", u._id).eq("status", "active"))
          .take(100);
        return {
          _id: u._id,
          name: u.name,
          role: u.role,
          trustedLender: u.trustedLender,
          createdAt: u.createdAt,
          activeToolCount: active.length,
        };
      }),
    );
  },
});

function nameLoader(ctx: QueryCtx) {
  const cache = new Map<string, Promise<Doc<"users"> | null>>();
  return async (id: Id<"users">) => {
    let p = cache.get(id);
    if (!p) cache.set(id, (p = ctx.db.get("users", id)));
    return (await p)?.name ?? FALLBACK_NAME;
  };
}

// AUTH: requireAdmin
export const listTools = query({
  args: { includeRemoved: v.optional(v.boolean()) },
  returns: v.array(
    v.object({
      _id: v.id("tools"),
      name: v.string(),
      category: categoryValidator,
      status: toolStatusValidator,
      ownerName: v.string(),
      createdAt: v.number(),
      removedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { includeRemoved }) => {
    await requireAdmin(ctx);
    const loadName = nameLoader(ctx);
    const tools =
      includeRemoved === true
        ? await ctx.db.query("tools").order("desc").take(LIST_CAP)
        : await ctx.db
            .query("tools")
            .withIndex("by_status", (q) => q.eq("status", "active"))
            .order("desc")
            .take(LIST_CAP);
    return Promise.all(
      tools.map(async (t) => ({
        _id: t._id,
        name: t.name,
        category: t.category,
        status: t.status,
        ownerName: await loadName(t.ownerId),
        createdAt: t.createdAt,
        ...(t.removedAt !== undefined ? { removedAt: t.removedAt } : {}),
      })),
    );
  },
});

// AUTH: requireAdmin
export const listLoans = query({
  args: { status: v.optional(loanStatusValidator) },
  returns: v.array(
    v.object({
      _id: v.id("loans"),
      toolName: v.string(),
      ownerName: v.string(),
      borrowerName: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      status: loanStatusValidator,
      displayStatus: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const loadName = nameLoader(ctx);
    const today = todayUtc();
    const loans =
      status === undefined
        ? await ctx.db.query("loans").order("desc").take(LIST_CAP)
        : await ctx.db
            .query("loans")
            .withIndex("by_status_endDate", (q) => q.eq("status", status))
            .order("desc")
            .take(LIST_CAP);
    const rows = await Promise.all(
      loans.map(async (l) => {
        const tool = await ctx.db.get("tools", l.toolId);
        return {
          _id: l._id,
          toolName: tool?.name ?? "Removed tool",
          ownerName: await loadName(l.ownerId),
          borrowerName: await loadName(l.borrowerId),
          startDate: l.startDate,
          endDate: l.endDate,
          status: l.status,
          displayStatus: deriveDisplayStatus(l, today) as string,
          createdAt: l.createdAt,
        };
      }),
    );
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// AUTH: requireAdmin. Target labels are resolved server-side; raw target ids are not returned.
export const listAuditLog = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("auditLog"),
      createdAt: v.number(),
      actorLabel: v.string(),
      actorName: v.optional(v.string()),
      action: auditActionValidator,
      targetType: auditTargetTypeValidator,
      targetLabel: v.string(),
      reason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { limit }) => {
    await requireAdmin(ctx);
    const n =
      limit === undefined || !Number.isFinite(limit)
        ? AUDIT_DEFAULT
        : Math.min(AUDIT_MAX, Math.max(1, Math.floor(limit)));
    const loadName = nameLoader(ctx);
    const rows = await ctx.db.query("auditLog").withIndex("by_createdAt").order("desc").take(n);
    return Promise.all(
      rows.map(async (r) => {
        let targetLabel = FALLBACK_NAME;
        if (r.targetType === "user") {
          const id = ctx.db.normalizeId("users", r.targetId);
          if (id) targetLabel = await loadName(id);
        } else if (r.targetType === "tool") {
          const id = ctx.db.normalizeId("tools", r.targetId);
          const tool = id ? await ctx.db.get("tools", id) : null;
          if (tool) targetLabel = tool.name;
        } else {
          const id = ctx.db.normalizeId("loans", r.targetId);
          const loan = id ? await ctx.db.get("loans", id) : null;
          const tool = loan ? await ctx.db.get("tools", loan.toolId) : null;
          if (tool) targetLabel = `Loan of ${tool.name}`;
        }
        return {
          _id: r._id,
          createdAt: r.createdAt,
          actorLabel: r.actorLabel,
          ...(r.actorId ? { actorName: await loadName(r.actorId) } : {}),
          action: r.action,
          targetType: r.targetType,
          targetLabel,
          ...(r.reason ? { reason: r.reason } : {}),
        };
      }),
    );
  },
});

// AUTH: requireAdmin. Messages were sanitized/redacted/truncated at write time.
export const listWorkflowErrors = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("workflowErrors"),
      createdAt: v.number(),
      workflowName: v.string(),
      executionId: v.string(),
      nodeName: v.optional(v.string()),
      message: v.string(),
      loanId: v.optional(v.id("loans")),
    }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("workflowErrors")
      .withIndex("by_createdAt")
      .order("desc")
      .take(ERRORS_CAP);
    return rows.map((r) => ({
      _id: r._id,
      createdAt: r.createdAt,
      workflowName: r.workflowName,
      executionId: r.executionId,
      ...(r.nodeName ? { nodeName: r.nodeName } : {}),
      message: r.message,
      ...(r.loanId ? { loanId: r.loanId } : {}),
    }));
  },
});
