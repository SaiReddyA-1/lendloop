import { mutation } from "../_generated/server";
import { requireUser } from "./auth";

// AUTH: requireUser
export const sneaky = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
  },
});
