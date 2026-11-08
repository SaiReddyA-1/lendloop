import { query } from "./_generated/server";
import { requireUser } from "./lib/auth";

export const list = query({ args: {}, handler: async (ctx) => { await requireUser(ctx); } });
