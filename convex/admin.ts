import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { appError } from "./lib/errors";

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
