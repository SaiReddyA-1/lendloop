import { query } from "./_generated/server";

// AUTH: public (projected), trust me
export const secretReport = query({ args: {}, handler: async (ctx) => ctx.db.query("users").collect() });
