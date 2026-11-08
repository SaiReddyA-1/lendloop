import { mutation } from "./_generated/server";

// AUTH: requireUser (claimed but never called)
export const create = mutation({ args: {}, handler: async (ctx) => ctx.db.insert("tools", {}) });
