# Security controls map

Standards: OWASP ASVS 5.0 L2, OWASP Top 10 2025, OWASP API Security Top 10 2023. Status: done / partial / planned.

## OWASP Top 10 2025
| Category | Control | Status |
|---|---|---|
| A01 Broken Access Control | `requireUser`/`requireAdmin`/`requireToolOwner`/`requireLoanParty` (`convex/lib/auth.ts`); identity from `ctx.auth` only; `npm run authz` static guard; proxy gate (UX only). Tests: `convex/lib/auth.test.ts`, `convex/users.test.ts` | partial (guards + users done; feature functions in later phases) |
| A02 Security Misconfiguration | Static security headers, `poweredByHeader: false`, strict TS, env templates | done |
| A03 Software Supply Chain Failures | Lockfile, minimal deps, removed unneeded `cn` package, `npm audit` review | partial |
| A04 Cryptographic Failures | TLS + HSTS preload; tokens handled by Clerk; HMAC for n8n webhooks | partial (HSTS done) |
| A05 Injection | `v.*` arg validation + domain checks; no raw queries; React escaping | planned |
| A06 Insecure Design | `loanStateMachine.ts` is the only definition of loan transitions; overlap re-check on approve; auto-decline of conflicting requests; owner-only return (ADR-014..017). Tests: `loans.test.ts`, `loanStateMachine.test.ts` | partial (loans/tools done) |
| A07 Authentication Failures | Delegated to Clerk (MFA, sessions); Convex validates JWT issuer; UNAUTHENTICATED / USER_NOT_PROVISIONED fail-closed; admin by immutable Clerk id. Tests: `users.test.ts`, `auth.test.ts` | done |
| A08 Software or Data Integrity Failures | Signed n8n webhooks; inbound bearer token compared in constant time | planned |
| A09 Security Logging and Alerting Failures | Audit log of state changes; no PII in logs | planned |
| A10 Mishandling of Exceptional Conditions | Generic client errors, typed `ConvexError`, fail-closed guards | planned |

## OWASP API Security Top 10 2023
| Category | Control | Status |
|---|---|---|
| API1 Broken Object Level Authorization | `requireToolOwner`/`requireLoanParty`; NOT_FOUND for foreign objects (ADR-009). Applied to every tool/loan mutation; admins cannot edit tools or act on loans. Tests: `auth.test.ts`, `tools.test.ts`, `loans.test.ts` | done (tools/loans) |
| API2 Broken Authentication | Clerk + Convex JWT verification | done (config) |
| API3 Broken Object Property Level Authorization | `ensureCurrent` takes no args; `me` explicit projection; tools/loans responses are built field-by-field (no doc spreads) with `returns:` validators locking shapes; `listPublic` is exactly `{name, category}`; owner/borrower ids, email, tokenIdentifier never returned; owner derived server-side on request. Tests: `users.test.ts`, `tools.test.ts`, `loans.test.ts` (deep key scans) | done (users/tools/loans) |
| API4 Unrestricted Resource Consumption | `take()` caps (200 tools / 100 loans; ADR-018), name/description length limits, 50 active tools per user, 5 pending + 10/hour requests per borrower, 30-day max loan (ADR-019). Production: pagination + `@convex-dev/rate-limiter` | partial |
| API5 Broken Function Level Authorization | `requireAdmin`; admin ops are `internalMutation`s not on `api`; `// AUTH:` + `npm run authz`. Tests: `admin.test.ts`, `auth.test.ts` | partial (foundation done) |
| API6 Unrestricted Access to Sensitive Business Flows | Request flow: valid/non-past dates, max duration, no self-borrow, no double-booking, no duplicate pending, per-user pending + hourly caps; approve re-checks availability and expiry; only the owner approves/declines/returns, only the borrower cancels; invalid transitions rejected. Tests: `loans.test.ts` | done (rate-limiter service planned) |
| API7 Server Side Request Forgery | Fixed n8n URL from env; no user-supplied URLs fetched | planned |
| API8 Security Misconfiguration | Headers, CSP, env hygiene | done |
| API9 Improper Inventory Management | One Convex deployment per env; documented functions | planned |
| API10 Unsafe Consumption of APIs | Validate n8n inbound payloads with `v.*`; authenticate callers | planned |

## Phase 1 specifics
- Headers (`next.config.ts`): HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options, COOP. done
- CSP (`proxy.ts` via Clerk): frame-ancestors, object-src, base-uri, form-action, Convex connect-src. done
- Secrets hygiene: `.env*` ignored (templates allowed), `convex.env.example`, secrets only in env. done
- Accessibility baseline (WCAG 2.2 AA): skip link, focus ring, reduced motion, contrast-checked tokens. done

## Phase 2 specifics
- Schema for all tables with indexes for owner/borrower/status queries and rate limiting. done
- Audit log (`convex/lib/audit.ts`): role changes written with actor label (`user`, `system:bootstrap`, `system:cli`); reasons sanitized and capped. done (A09 partial)
- Validation helpers (`assertLength`, `sanitizeText`) and shared validators in `convex/lib/validation.ts`. done
- Env access centralized in `convex/lib/env.ts`. done

## Phase 3 specifics
- Tools + loans functions (`convex/tools.ts`, `convex/loans.ts`): every export has `// AUTH:` and a guard (`npm run authz`); `listPublic` is the only unauthenticated function.
- `loans.request` validates in a fixed order with distinct safe messages; free text passes `sanitizeText` + `assertLength`.
- Outbox rows (`automationEvents`) hold ids/type only; written in the same transaction as every state change. Delivery in phase 6.
