import { query } from "./_generated/server";

const doc = `
// AUTH: requireUser
`;
export const listAll = query({ args: {}, handler: async (ctx) => [doc, await ctx.db.query("users").collect()] });
