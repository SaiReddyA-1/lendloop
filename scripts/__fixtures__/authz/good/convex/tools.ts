import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";

// AUTH: public (projected). Allowlisted teaser.
export const listPublic = query({
  args: {},
  handler: async (ctx) => ctx.db.query("tools").collect(),
});

// AUTH: requireUser
export const list: unknown = query({
  args: {},
  handler: async (ctx) => {
    // this comment mentions export const fake = query( and is ignored
    const text = "export const fake2 = mutation(";
    await requireUser(ctx);
    return text;
  },
});

// AUTH: requireAdmin
export const typedAdmin: Foo<Bar> = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
  },
});
