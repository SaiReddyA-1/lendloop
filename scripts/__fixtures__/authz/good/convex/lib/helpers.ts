import { internalQuery, type QueryCtx } from "../_generated/server";

// A plain helper and an internal builder are fine in lib/.
export async function helper(ctx: QueryCtx) {
  const query = ctx.db.query("tools"); // a local variable named query is not the public builder
  return query.collect();
}
export const internalOne = internalQuery({ args: {}, handler: async () => 1 });
