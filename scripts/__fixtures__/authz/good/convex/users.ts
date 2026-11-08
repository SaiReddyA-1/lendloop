import { mutation, query } from "./_generated/server";

// AUTH: identity-only (self-provisioning).
export const ensureCurrent = mutation({ args: {}, handler: async () => null });

// AUTH: public (projected)
export const me = query({ args: {}, handler: async () => null });
