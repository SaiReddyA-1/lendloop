import type { AuthConfig } from "convex/server";

// Convex fails the deploy loudly if CLERK_JWT_ISSUER_DOMAIN is unset in the
// deployment environment (`npx convex env set CLERK_JWT_ISSUER_DOMAIN <issuer>`).
export default {
  providers: [
    {
      // eslint-disable-next-line @convex-dev/no-process-env -- auth.config.ts is evaluated at deploy time; documented Clerk pattern
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN as string,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
