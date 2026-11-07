# Architecture decisions

## ADR-001: Repo root is `lendloop/`
The parent directory name contains a space (`Fluence International`), which breaks unquoted shell paths and some tooling. The repo root is the `lendloop/` subfolder; git, npm and CI all run from there.

## ADR-002: `proxy.ts` instead of `middleware.ts`
Next.js 16 renamed request interception to `proxy.ts` (`middleware.ts` is deprecated). Clerk's `clerkMiddleware` is exported from `proxy.ts`. Paths are checked manually (`createRouteMatcher` is deprecated) and `auth.protect()` is called for `/dashboard` and `/admin`.

## ADR-003: Clerk native Convex integration
Convex validates Clerk session tokens directly (`convex/auth.config.ts`, `applicationID: "convex"`, issuer from `CLERK_JWT_ISSUER_DOMAIN`). No custom JWT template: fewer moving parts.

## ADR-004: Route protection in proxy is UX-only
The proxy redirects anonymous users away from `/dashboard` and `/admin`, but the data layer can be reached by other means (direct Convex client calls, stale sessions). The security boundary is Convex: every public function authenticates (`requireUser`/`requireAdmin`) and checks object ownership. Admin = Clerk user id listed in `ADMIN_CLERK_USER_IDS`, verified server-side.

## ADR-005: CSP via Clerk middleware option
`clerkMiddleware({ contentSecurityPolicy })` generates a CSP compatible with Clerk's origins and merges our directives (Convex `connect-src`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`; localhost Convex only outside production). Non-CSP headers (HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options, COOP) are static in `next.config.ts`. Clerk's `strict` mode (nonce + strict-dynamic) is a hardening candidate once pages are verified under it.

## ADR-006: Date handling
Loan dates are calendar dates stored as `YYYY-MM-DD` strings (no time zone), validated by `isIsoDate`. "Today" is computed in UTC (`todayUtc`). Because users live in different time zones, "not in the past" checks allow 1 day of tolerance relative to UTC today.

## ADR-007: Cache Components not enabled
`create-next-app` enabled `cacheComponents`/`partialPrefetching`. They were removed: the app is auth-driven and dynamic, so the feature adds Suspense constraints around Clerk with no caching benefit at this scope.

## ADR-008: Local `cn` helper
The shadcn init emitted imports from a third-party `cn` npm package. Replaced with the standard local `lib/utils.ts` (`clsx` + `tailwind-merge`) to avoid an unnecessary supply-chain dependency.

## ADR-009: NOT_FOUND instead of FORBIDDEN for objects the caller does not own
`requireToolOwner` / `requireLoanParty` throw `NOT_FOUND` both when the object does not exist and when the caller is not allowed to see it. A distinct FORBIDDEN would confirm that an id exists (enumeration / IDOR oracle, API1). FORBIDDEN is reserved for function-level checks (`requireAdmin`, API5) where the function's existence is not secret. Admins only bypass ownership when a call site explicitly passes `allowAdmin: true`.

## ADR-010: Admin bootstrap via `ADMIN_CLERK_USER_IDS` + internal CLI mutations
Admins are identified by Clerk user id (`user_...`, the JWT `sub`), not email: emails can be changed or unverified, ids are immutable and issued by Clerk. `ADMIN_CLERK_USER_IDS` (comma-separated, Convex env, read only in `convex/lib/env.ts`) promotes matching users at `users:ensureCurrent` and writes an audit row (`system:bootstrap`). Day-to-day role changes use `internalMutation`s (`admin:promoteToAdmin`, `admin:demoteToUser`) run via `npx convex run` with the deploy key; they are not callable by clients and audit as `system:cli`.

## ADR-011: The env allowlist never auto-demotes
Removing an id from `ADMIN_CLERK_USER_IDS` does not demote anyone. An env typo or a rollback would otherwise silently strip or (worse, via the inverse) grant privileges. The env is a bootstrap path only; demotion is an explicit, audited CLI action (`admin:demoteToUser`).

## ADR-012: Users are provisioned from verified JWT claims only
`users:ensureCurrent` takes no arguments and builds/refreshes the row solely from `ctx.auth.getUserIdentity()` (tokenIdentifier, subject, name, email). Clients cannot supply role, trusted flag, or ids (API3 BOPLA); Convex's `v.object` validation rejects extra args. Names are sanitized (control chars stripped, capped at 80). `users:me` returns an explicit projection (no tokenIdentifier/clerkUserId).

## ADR-013: Static authorization check (`npm run authz`)
`scripts/check-authz.mjs` fails CI if any public `query`/`mutation`/`action`/`httpAction` export lacks an `// AUTH:` comment directly above it, or (unless it says `public` / `identity-only`) lacks a `requireUser/requireAdmin/requireToolOwner/requireLoanParty` call. It is a regex/paren-matching lint with documented limits (see the script header); it complements, not replaces, behavioural tests and review of `public` claims.
