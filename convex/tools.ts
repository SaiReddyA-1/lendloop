import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireToolOwner, requireUser } from "./lib/auth";
import { todayUtc } from "./lib/dates";
import { appError } from "./lib/errors";
import { removeToolAndCancelPending } from "./lib/toolRemoval";
import {
  assertLength,
  categoryValidator,
  conditionValidator,
  LIMITS,
  sanitizeText,
} from "./lib/validation";

const LIST_CAP = 200; // ADR: take() caps instead of pagination for now.
const MAX_ACTIVE_TOOLS_PER_USER = 50;
const REMOVED_CAP = 50; // listMine shows at most this many removed tools (after all active ones)
const HOUR_MS = 3_600_000;

const toolItemValidator = v.object({
  _id: v.id("tools"),
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
  ownerName: v.string(),
  ownerTrustedLender: v.boolean(),
  photoUrl: v.union(v.string(), v.null()),
  isMine: v.boolean(),
  availability: v.union(v.literal("available"), v.literal("on_loan")),
});

/** Caches owner rows per request so a listing does one lookup per distinct owner. */
function ownerLoader(ctx: QueryCtx) {
  const cache = new Map<string, Promise<Doc<"users"> | null>>();
  return (id: Doc<"users">["_id"]) => {
    let p = cache.get(id);
    if (!p) {
      p = ctx.db.get("users", id);
      cache.set(id, p);
    }
    return p;
  };
}

async function isOnLoanToday(ctx: QueryCtx, toolId: Doc<"tools">["_id"], today: string) {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .take(100);
  return approved.some((l) => l.startDate <= today && today <= l.endDate);
}

async function projectTool(
  ctx: QueryCtx,
  tool: Doc<"tools">,
  me: Doc<"users">,
  loadOwner: ReturnType<typeof ownerLoader>,
  today: string,
) {
  const owner = await loadOwner(tool.ownerId);
  return {
    _id: tool._id,
    name: tool.name,
    category: tool.category,
    condition: tool.condition,
    description: tool.description,
    ownerName: owner?.name ?? "Neighbor",
    ownerTrustedLender: owner?.trustedLender ?? false,
    photoUrl: tool.photoId ? await ctx.storage.getUrl(tool.photoId) : null,
    isMine: tool.ownerId === me._id,
    availability: (await isOnLoanToday(ctx, tool._id, today))
      ? ("on_loan" as const)
      : ("available" as const),
  };
}

// AUTH: public (projected). Landing-page teaser for signed-out visitors: only { name, category } of active tools, built explicitly (no ids, no owner info).
export const listPublic = query({
  args: {},
  returns: v.array(v.object({ name: v.string(), category: categoryValidator })),
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .take(LIST_CAP);
    return tools.map((t) => ({ name: t.name, category: t.category }));
  },
});

// AUTH: requireUser. Board listing of active tools with a safe owner projection (no email / identity ids).
export const list = query({
  args: { category: v.optional(categoryValidator) },
  returns: v.array(toolItemValidator),
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const { category } = args;
    const base = ctx.db.query("tools");
    const indexed =
      category === undefined
        ? base.withIndex("by_status", (q) => q.eq("status", "active"))
        : base.withIndex("by_status_category", (q) =>
            q.eq("status", "active").eq("category", category),
          );
    const tools = await indexed.order("desc").take(LIST_CAP);
    const today = todayUtc();
    const loadOwner = ownerLoader(ctx);
    return Promise.all(tools.map((t) => projectTool(ctx, t, me, loadOwner, today)));
  },
});

// AUTH: requireUser. Returns only the caller's own tools (derived from identity), with pending-request counts.
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("tools"),
      name: v.string(),
      category: categoryValidator,
      condition: conditionValidator,
      description: v.string(),
      status: v.union(v.literal("active"), v.literal("removed")),
      removedByAdmin: v.boolean(),
      photoUrl: v.union(v.string(), v.null()),
      pendingRequests: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    // Active and removed are read separately (active first) so a pile of removed rows can never hide active tools.
    const activeTools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id).eq("status", "active"))
      .order("desc")
      .take(LIST_CAP);
    const removedTools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id).eq("status", "removed"))
      .order("desc")
      .take(REMOVED_CAP);
    const tools = [...activeTools, ...removedTools];
    const pendingLoans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id).eq("status", "pending"))
      .take(500);
    const counts = new Map<string, number>();
    for (const l of pendingLoans) counts.set(l.toolId, (counts.get(l.toolId) ?? 0) + 1);
    return Promise.all(
      tools.map(async (t) => ({
        _id: t._id,
        name: t.name,
        category: t.category,
        condition: t.condition,
        description: t.description,
        status: t.status,
        removedByAdmin:
          t.status === "removed" && t.removedBy !== undefined && t.removedBy !== t.ownerId,
        photoUrl: t.photoId ? await ctx.storage.getUrl(t.photoId) : null,
        pendingRequests: counts.get(t._id) ?? 0,
      })),
    );
  },
});

// AUTH: requireUser. Active tool detail + booked ranges (no borrower info). Removed tools are NOT_FOUND for everyone, owner included (owners see removed tools via listMine).
export const get = query({
  args: { toolId: v.id("tools") },
  returns: v.object({
    ...toolItemValidator.fields,
    bookedRanges: v.array(v.object({ startDate: v.string(), endDate: v.string() })),
  }),
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get("tools", args.toolId);
    if (!tool || tool.status !== "active") {
      throw appError("NOT_FOUND", "We couldn't find that item.");
    }
    const today = todayUtc();
    const item = await projectTool(ctx, tool, me, ownerLoader(ctx), today);
    const approved = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "approved"))
      .take(100);
    const bookedRanges = approved
      .filter((l) => l.endDate >= today)
      .map((l) => ({ startDate: l.startDate, endDate: l.endDate }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return { ...item, bookedRanges };
  },
});

function cleanName(raw: string): string {
  return assertLength("Name", sanitizeText(raw), LIMITS.TOOL_NAME_MIN, LIMITS.TOOL_NAME_MAX);
}
function cleanDescription(raw: string): string {
  return assertLength("Description", sanitizeText(raw), 0, LIMITS.DESCRIPTION_MAX);
}

// AUTH: requireUser. Owner is the caller; capped at 50 active tools per user and 10 creations per hour (API4).
export const create = mutation({
  args: {
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  returns: v.id("tools"),
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const name = cleanName(args.name);
    const description = cleanDescription(args.description);
    const active = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id).eq("status", "active"))
      .take(MAX_ACTIVE_TOOLS_PER_USER);
    if (active.length >= MAX_ACTIVE_TOOLS_PER_USER) {
      throw appError(
        "RATE_LIMITED",
        "You have reached the limit of 50 listed tools. Remove one first.",
      );
    }
    const now = Date.now();
    // Creation rate limit (rolling hour, counts removed tools too) against listing spam.
    const recent = await ctx.db
      .query("tools")
      .withIndex("by_owner_created", (q) =>
        q.eq("ownerId", me._id).gte("createdAt", now - HOUR_MS),
      )
      .take(LIMITS.MAX_TOOL_CREATES_PER_HOUR);
    if (recent.length >= LIMITS.MAX_TOOL_CREATES_PER_HOUR) {
      throw appError("RATE_LIMITED", "You're adding tools too quickly. Please try again later.");
    }
    return ctx.db.insert("tools", {
      ownerId: me._id,
      name,
      category: args.category,
      condition: args.condition,
      description,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// AUTH: requireToolOwner (owner only; admins are NOT allowed to edit users' tools).
export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.optional(v.string()),
    category: v.optional(categoryValidator),
    condition: v.optional(conditionValidator),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { tool } = await requireToolOwner(ctx, args.toolId);
    if (tool.status !== "active") {
      throw appError("CONFLICT", "This tool has been removed and can't be edited.");
    }
    if (
      args.name === undefined &&
      args.category === undefined &&
      args.condition === undefined &&
      args.description === undefined
    ) {
      throw appError("VALIDATION", "Provide at least one field to update.");
    }
    const patch: Partial<Pick<Doc<"tools">, "name" | "category" | "condition" | "description">> =
      {};
    if (args.name !== undefined) patch.name = cleanName(args.name);
    if (args.category !== undefined) patch.category = args.category;
    if (args.condition !== undefined) patch.condition = args.condition;
    if (args.description !== undefined) patch.description = cleanDescription(args.description);
    await ctx.db.patch("tools", tool._id, { ...patch, updatedAt: Date.now() });
    return null;
  },
});

// AUTH: requireToolOwner (owner only). Soft-deletes; blocked while an approved loan is open.
export const remove = mutation({
  args: { toolId: v.id("tools") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, tool } = await requireToolOwner(ctx, args.toolId);
    if (tool.status !== "active") {
      throw appError("CONFLICT", "This tool has already been removed.");
    }
    // Approved == not yet returned (returned loans leave "approved"), so any approved loan blocks removal.
    const openLoan = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "approved"))
      .first();
    if (openLoan) throw appError("CONFLICT", "Mark the current loan as returned first.");
    await removeToolAndCancelPending(ctx, tool, user._id);
    return null;
  },
});
