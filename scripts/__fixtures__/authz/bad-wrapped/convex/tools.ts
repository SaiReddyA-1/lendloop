import { query } from "./_generated/server";
import { wrap } from "./lib/wrap";

export const wrapped = wrap(query({ args: {}, handler: async (ctx) => ctx.db.query("users").collect() }));
