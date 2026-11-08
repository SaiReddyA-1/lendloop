import { mutation } from "./_generated/server";

// AUTH: requireUser
export const create = mutation({
  args: {},
  handler: async (ctx) => {
    // await requireUser(ctx);
    /* requireAdmin(ctx) */
    return ctx.db.insert("tools", {});
  },
});
