import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { adminClerkUserIdsRaw } from "./env";
import { appError } from "./errors";

type Ctx = QueryCtx | MutationCtx;

/**
 * Authorization core. Identity ALWAYS comes from `ctx.auth` (verified JWT);
 * no helper here accepts a user id from the caller.
 */

export async function getIdentityOrThrow(ctx: Ctx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("UNAUTHENTICATED", "Please sign in to continue.");
  return identity;
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await getIdentityOrThrow(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) {
    throw appError("USER_NOT_PROVISIONED", "Your account is still being set up. Please retry.");
  }
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw appError("FORBIDDEN", "You do not have permission to do that.");
  return user;
}

const notFound = () => appError("NOT_FOUND", "We couldn't find that item.");

/**
 * Loads a tool the caller owns. A missing tool and a tool owned by someone
 * else are deliberately indistinguishable (NOT_FOUND) to prevent enumeration.
 */
export async function requireToolOwner(
  ctx: Ctx,
  toolId: Id<"tools">,
  opts: { allowAdmin?: boolean } = {},
): Promise<{ user: Doc<"users">; tool: Doc<"tools"> }> {
  const user = await requireUser(ctx);
  const tool = await ctx.db.get("tools", toolId);
  if (!tool) throw notFound();
  const isOwner = tool.ownerId === user._id;
  const adminOk = opts.allowAdmin === true && user.role === "admin";
  if (!isOwner && !adminOk) throw notFound();
  return { user, tool };
}

/** Loads a loan if the caller is the required party (or an allowed admin); else NOT_FOUND. */
export async function requireLoanParty(
  ctx: Ctx,
  loanId: Id<"loans">,
  party: "owner" | "borrower" | "either",
  opts: { allowAdmin?: boolean } = {},
): Promise<{ user: Doc<"users">; loan: Doc<"loans"> }> {
  const user = await requireUser(ctx);
  const loan = await ctx.db.get("loans", loanId);
  if (!loan) throw notFound();
  const isOwner = loan.ownerId === user._id;
  const isBorrower = loan.borrowerId === user._id;
  const partyOk =
    party === "owner" ? isOwner : party === "borrower" ? isBorrower : isOwner || isBorrower;
  const adminOk = opts.allowAdmin === true && user.role === "admin";
  if (!partyOk && !adminOk) throw notFound();
  return { user, loan };
}

/** True if the Clerk user id is listed in ADMIN_CLERK_USER_IDS (comma-separated). */
export function isAdminAllowlisted(clerkUserId: string): boolean {
  if (!clerkUserId) return false;
  return adminClerkUserIdsRaw()
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .includes(clerkUserId);
}
