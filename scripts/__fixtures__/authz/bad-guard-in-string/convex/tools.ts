import { mutation } from "./_generated/server";

// AUTH: requireUser
export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const note = "requireUser(ctx)";
    const tpl = `requireAdmin(ctx) ${note}`;
    return [tpl, await ctx.db.insert("tools", {})];
  },
});
