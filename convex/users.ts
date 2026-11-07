import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { getIdentityOrThrow, isAdminAllowlisted, requireUser } from "./lib/auth";
import { LIMITS, sanitizeText } from "./lib/validation";

function displayName(identity: { name?: string; givenName?: string; email?: string }): string {
  const candidates = [identity.name, identity.givenName, identity.email?.split("@")[0]];
  for (const c of candidates) {
    const cleaned = c ? sanitizeText(c).slice(0, LIMITS.USER_NAME_MAX).trim() : "";
    if (cleaned) return cleaned;
  }
  return "Neighbor";
}

// AUTH: identity-only (self-provisioning). Takes NO args; the row is derived solely from verified JWT claims.
// Allowlisted Clerk ids (ADMIN_CLERK_USER_IDS) are promoted to admin; removal from the env never demotes.
export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await getIdentityOrThrow(ctx);
    const name = displayName(identity);
    const email = identity.email
      ? sanitizeText(identity.email).slice(0, 254) || undefined
      : undefined;
    const allowlisted = isAdminAllowlisted(identity.subject);
    const now = Date.now();

    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!existing) {
      const id = await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        clerkUserId: identity.subject,
        name,
        ...(email ? { email } : {}),
        role: allowlisted ? "admin" : "user",
        trustedLender: false,
        createdAt: now,
        updatedAt: now,
      });
      if (allowlisted) {
        await writeAudit(ctx, {
          actor: "system:bootstrap",
          action: "user.role.promote",
          targetType: "user",
          targetId: id,
          reason: "allowlisted at signup",
        });
      }
      return { role: allowlisted ? ("admin" as const) : ("user" as const), name };
    }

    let role = existing.role;
    const patch: { name?: string; email?: string; role?: "admin"; updatedAt?: number } = {};
    if (existing.name !== name) patch.name = name;
    if (email !== undefined && existing.email !== email) patch.email = email;
    if (allowlisted && existing.role !== "admin") {
      patch.role = "admin";
      role = "admin";
      await writeAudit(ctx, {
        actor: "system:bootstrap",
        action: "user.role.promote",
        targetType: "user",
        targetId: existing._id,
        reason: "allowlisted",
      });
    }
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = now;
      await ctx.db.patch("users", existing._id, patch);
    }
    return { role, name };
  },
});

// AUTH: public (projected). Returns null when signed out or not yet provisioned (lets the UI render a loading state); otherwise only the caller's own projected fields.
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});
