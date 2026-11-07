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

## ADR-014: Approving a request auto-declines overlapping pending requests
When an owner approves a loan, every other *pending* loan on the same tool whose date range overlaps (inclusive) is declined in the same transaction, each with a `request_declined` outbox event to its borrower. Leaving them pending would invite approvals that can only fail the overlap re-check, and would leave borrowers waiting on a request that can never succeed. Approval also re-checks overlap against other approved loans (race safety: Convex mutations are serializable) and rejects expired requests (`endDate` past, with the ADR-006 tolerance).

## ADR-015: Only the owner can mark a loan returned
`loans.markReturned` is owner-only (no borrower, no admin). The lender is the party who can verify the tool is back; letting a borrower self-certify would defeat overdue tracking. Admin intervention, if ever needed, would be an explicit audited internal function.

## ADR-016: Tool removal is a soft delete that cancels pending requests
`tools.remove` sets `status: "removed"` (+ `removedAt`, `removedBy`) instead of deleting, preserving loan history and audit references. It is blocked (CONFLICT) while any approved (unreturned) loan exists, and cancels all pending loans via the state machine actor `system`, emitting `request_cancelled` to each borrower. The logic lives in `convex/lib/toolRemoval.ts` so phase-5 admin removal reuses it (and adds the audit row). Removed tools are NOT_FOUND in `tools.get` even for the owner; owners see them via `tools.listMine` (flagged, `removedByAdmin`).

## ADR-017: Loan date ranges overlap inclusively
Both start and end days are "in use": a loan ending on the 12th conflicts with one starting on the 12th. Dates are whole calendar days, so there is no hand-over time within a day; allowing same-day turnover would need times. `rangesOverlap` in `convex/lib/dates.ts` is the single implementation.

## ADR-018: `take()` caps instead of pagination (for now)
List queries are bounded (tools 200, loans 100 per list, per-tool loan reads 100/200) so no query can scan unbounded data (API4). The MVP board is small enough that a cap is acceptable; production should move to `.paginate()` with cursors and a search index, and surface "showing newest N" in the UI until then. `listIncoming` reads up to 100 per status and merges, because `by_owner` sorts by status first.

## ADR-019: Rate limits are indexed counts inside the mutation
`loans.request` enforces max 5 pending requests per borrower (`by_borrower` + status) and max 10 requests per rolling hour (`by_borrower_created`; cancelled requests still count so cancel-spam cannot bypass it); `tools.create` caps 50 active tools per user. Counting inside the mutation is transactional (no race can exceed the cap) and needs no extra dependency, but it only limits business flows, not raw call volume or failed attempts. For production add `@convex-dev/rate-limiter` (token buckets per user/function, including failed calls). Values live in `LIMITS` (`convex/lib/validation.ts`).

## ADR-020: Transactional outbox for loan events
Every loan state change inserts an `automationEvents` row via `enqueueLoanEvent` in the same mutation (ids and type only, no PII). Phase 6 adds scheduling of the delivery action at the marked point. State machine: `convex/lib/loanStateMachine.ts`; derived display status (`active`/`overdue`) is computed at read time, never stored.

## ADR-021: Two secrets, two directions (HMAC out, bearer in)
Convex -> n8n requests are signed with `N8N_WEBHOOK_SECRET` (`X-LendLoop-Signature: sha256=HMAC(secret, "<timestamp>.<rawBody>")` plus `X-LendLoop-Timestamp`; n8n verifies the signature and rejects timestamps older than 300 s, which blocks replay). n8n -> Convex requests present `Authorization: Bearer <N8N_INBOUND_TOKEN>`, compared in constant time (`verifyBearer`). Separate secrets mean a leak in one direction cannot forge the other, and each can be rotated independently. The inbound token is stored in an n8n Header Auth credential, so it never appears in exported workflow JSON. Both are read only in `convex/lib/env.ts`; a missing secret fails closed (outbound: event marked `NOT_CONFIGURED`; inbound: 503).

## ADR-022: Admin removal keeps approved loans; delivery semantics and backoff
Admin `removeTool` cancels PENDING requests (borrowers are notified through the outbox) but does NOT cancel APPROVED loans: the borrower may physically hold the tool and cancelling would erase the record needed to get it returned. The owner-side removal is stricter (blocked while a live approved loan exists). Delivery: an HTTP 2xx from n8n means "delivered"; the workflow must respond only after the email node succeeded (respond-after-last-node), otherwise failures would be hidden. Retryable: 408, 429, 5xx, network error, 10 s timeout. Backoff after attempt N = [30 s, 2 min, 8 min, 30 min, 2 h][N-1], max 5 attempts in total (`MAX_ATTEMPTS`/`BACKOFF_MS` in `convex/notifications.ts`; the 2 h entry is unused headroom). Other 4xx fail immediately (the request is wrong; retrying cannot help). `Idempotency-Key` = event id lets n8n de-duplicate if a 2xx response was lost.

## ADR-023: Server-side idempotency key; no self-trust
Reminder idempotency keys (`<loanId>:<YYYY-MM-DD>`) are computed on the server from validated fields; a client-supplied key is ignored, so n8n retries or a buggy workflow cannot create duplicate reminders or poison the key space. Admins cannot grant or revoke their own `trustedLender` flag (FORBIDDEN): trust is a peer-endorsement signal, so self-assignment is a conflict of interest; another admin must do it. Unchanged values are a no-op and write no audit row.
