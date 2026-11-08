import { query } from "./_generated/server";

export default query({ args: {}, handler: async (ctx) => ctx.db.query("users").collect() });
