# Security controls map

Standards: OWASP ASVS 5.0 L2, OWASP Top 10 2025, OWASP API Security Top 10 2023. Status: done / partial / planned.

## OWASP Top 10 2025
| Category | Control | Status |
|---|---|---|
| A01 Broken Access Control | `requireUser`/`requireAdmin` in every Convex function; ownership checks; identity from `ctx.auth` only; proxy gate (UX only) | planned (proxy gate done) |
| A02 Security Misconfiguration | Static security headers, `poweredByHeader: false`, strict TS, env templates | done |
| A03 Software Supply Chain Failures | Lockfile, minimal deps, removed unneeded `cn` package, `npm audit` review | partial |
| A04 Cryptographic Failures | TLS + HSTS preload; tokens handled by Clerk; HMAC for n8n webhooks | partial (HSTS done) |
| A05 Injection | `v.*` arg validation + domain checks; no raw queries; React escaping | planned |
| A06 Insecure Design | Threat model per feature; state transitions validated server-side | planned |
| A07 Authentication Failures | Delegated to Clerk (MFA, sessions); Convex validates JWT issuer | done (config) |
| A08 Software or Data Integrity Failures | Signed n8n webhooks; inbound bearer token compared in constant time | planned |
| A09 Security Logging and Alerting Failures | Audit log of state changes; no PII in logs | planned |
| A10 Mishandling of Exceptional Conditions | Generic client errors, typed `ConvexError`, fail-closed guards | planned |

## OWASP API Security Top 10 2023
| Category | Control | Status |
|---|---|---|
| API1 Broken Object Level Authorization | Ownership check on every object access | planned |
| API2 Broken Authentication | Clerk + Convex JWT verification | done (config) |
| API3 Broken Object Property Level Authorization | Explicit DTOs; never accept role/user fields | planned |
| API4 Unrestricted Resource Consumption | Pagination, length caps, write rate limits | planned |
| API5 Broken Function Level Authorization | `requireAdmin`; `internal*` for non-client functions | planned |
| API6 Unrestricted Access to Sensitive Business Flows | Per-user request limits, state-machine checks | planned |
| API7 Server Side Request Forgery | Fixed n8n URL from env; no user-supplied URLs fetched | planned |
| API8 Security Misconfiguration | Headers, CSP, env hygiene | done |
| API9 Improper Inventory Management | One Convex deployment per env; documented functions | planned |
| API10 Unsafe Consumption of APIs | Validate n8n inbound payloads with `v.*`; authenticate callers | planned |

## Phase 1 specifics
- Headers (`next.config.ts`): HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options, COOP. done
- CSP (`proxy.ts` via Clerk): frame-ancestors, object-src, base-uri, form-action, Convex connect-src. done
- Secrets hygiene: `.env*` ignored (templates allowed), `convex.env.example`, secrets only in env. done
- Accessibility baseline (WCAG 2.2 AA): skip link, focus ring, reduced motion, contrast-checked tokens. done
