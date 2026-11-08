import { query } from "./_generated/server";

const hidden = query({ args: {}, handler: async (ctx) => ctx.db.query("users").collect() });
export { hidden as listEverything };
