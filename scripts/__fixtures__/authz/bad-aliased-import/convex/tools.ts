import { query as q } from "./_generated/server";

export const sneaky = q({ args: {}, handler: async (ctx) => ctx.db.query("users").collect() });
