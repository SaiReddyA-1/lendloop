# Production changes

What I would change before real users, in priority order. Each item says why. "Today" describes the repo as it is; ADR numbers refer to `docs/DECISIONS.md`.

## P0: before any public launch

| # | Change | Why |
|---|---|---|
| 1 | **Hosting.** Next.js on Vercel; a separate Convex **production deployment** (own URL, own env); Clerk **production instance** on your own domain (not `*.clerk.accounts.dev`); set `CLERK_JWT_ISSUER_DOMAIN` to the production issuer and `ADMIN_CLERK_USER_IDS` to real admins. | Dev and prod must not share data, keys or issuers. Convex dev deployments are not for real data. |
| 2 | **n8n hosting.** Either n8n Cloud, or self-hosted in **queue mode** (main + webhook processors + workers, Postgres, Redis) behind a TLS reverse proxy. Expose only `POST /webhook/lendloop-loan-events` publicly; keep the editor, REST API and `/healthz` private (VPN/SSO). Optionally add a source IP allowlist or mTLS at the proxy where the platform provides stable egress addresses (check Convex's current documentation; do not assume fixed IPs). Set `N8N_PROTOCOL=https` and `N8N_SECURE_COOKIE=true` (both default to the local-only values in `n8n/docker-compose.yml`). The Convex `N8N_WEBHOOK_URL` must be https, otherwise events fail with `INSECURE_WEBHOOK_URL` (the payload carries recipient name and email). | Today n8n is single-process, SQLite, loopback only (ADR-029). A webhook burst or a restart loses in-flight work, and the editor must never face the internet. The HMAC makes the webhook safe to expose, network controls are defense in depth. |
| 3 | **Secrets management.** Secrets live in Convex env (`N8N_WEBHOOK_SECRET`, `N8N_INBOUND_TOKEN`), Vercel env (`CLERK_SECRET_KEY`), n8n env/credentials (`LENDLOOP_WEBHOOK_SECRET`, SMTP). Store the n8n encryption key as a secret file or secret-manager mount (`N8N_ENCRYPTION_KEY_FILE`), not as an env var; both tokens (`N8N_WEBHOOK_SECRET`, `N8N_INBOUND_TOKEN`) must be at least 32 chars. Use a secret manager as source of truth (1Password/Vault/AWS SM), mark Vercel vars sensitive, never reuse dev values. Escrow the n8n encryption key separately from DB backups. Rotate on schedule (90 days) and on staff change. | One leaked secret should be a routine rotation, not an incident. Losing the n8n encryption key makes stored credentials unreadable. |
| 4 | **Dual-secret HMAC rotation** (today a single secret: rotation = brief outage window). Add `X-LendLoop-Key-Id`; Convex signs with the *current* key id; n8n holds `current` and `previous` and picks by id. Procedure: (1) add new key to n8n as `next`, (2) set Convex to sign with the new id, (3) after the 300 s replay window plus the longest retry delay (30 min) drop the old key. **Bearer token**: accept two tokens in `authorizeInbound` (`N8N_INBOUND_TOKEN`, `N8N_INBOUND_TOKEN_PREVIOUS`), update the n8n Header Auth credential, then remove the old one. | Retries scheduled before rotation are signed fresh at send time (the timestamp and signature are computed per attempt), but in-flight requests and mismatched deploy order still cause 401s without an overlap window. |
| 5 | **CI/CD** (GitHub Actions): on PR run `npm ci`, `npm run check`, `npm run build`, `npm audit --omit=dev` (fail on high), **gitleaks** (history, not just the working-tree tripwire in `scan:secrets`), CodeQL, Dependabot; deploy Convex with `npx convex deploy` (preview deployments per PR); regenerate workflows and fail if `git diff n8n/workflows` is dirty; branch protection (required checks, review, no force-push), signed commits optional. | Today everything is local discipline. The generator-drift check protects the "never hand-edit workflow JSON" rule. |
| 6 | **Legal and policy.** Terms of service and privacy policy; explicit statement that LendLoop is a matching board and not a party to loans (liability for damaged or unsafe tools, no insurance), user conduct and takedown rules, age requirement, DPA with each processor (Clerk, Convex, Vercel, email provider, n8n host). | Lending physical tools between strangers carries real liability and personal data is processed. |

## P1: first weeks in production

| Area | Change | Why |
|---|---|---|
| **Monitoring** | Sentry for Next.js (server and client, PII scrubbing on) and Convex log streams to Datadog (or Axiom). Monitor `automationEvents` in `failed` (admin tab Failed notifications) and keep Convex and n8n clocks on NTP (a 401 on clock skew is permanent, not retried). Alerts: spike in `automationEvents` with `status: failed`, events `pending` older than 15 min, any `workflowErrors` row, 5xx on `/api/n8n/*`, Convex function error rate. | Failures are currently visible only in the admin console. Someone has to be paged. |
| **n8n alerting** | Extend workflow 99 to post to Slack and page via PagerDuty/Opsgenie (keep the email). Add a heartbeat: WF2 pings an external monitor (e.g. healthchecks.io) each run so a dead scheduler is detected. | The error workflow cannot report its own outage or a trigger that never fired. |
| **SLOs** | Notification latency: p95 event-created to delivered < 60 s, p99 < 5 min; delivered ratio >= 99.5 percent within 1 h; WF2 runs daily. Measure from `automationEvents.createdAt` and `deliveredAt`. | Gives the alerts above a target. The data already exists. |
| **Dead-letter review** | Admins can already list failed events (admin tab Failed notifications) and re-drive them (`admin.retryAutomationEvent`, audited as `automation.retry`); add a daily digest of failed events older than 24 h. Events that exhaust 5 attempts are not retried automatically. | Retries end at attempt 5 (about 40 min of backoff); a longer n8n outage needs manual replay. |
| **Rate limiting** | `@convex-dev/rate-limiter` (token buckets per user and function, counting failed calls) in front of mutations and the HTTP actions; Clerk bot protection and sign-up attack protection; edge limits (Vercel WAF/Firewall) on `/` and sign-in routes. | Today limits are per-business-flow counts inside a transaction (ADR-019); they do not stop high-volume failing calls or enumeration attempts. |
| **Email deliverability** | Send through SES or Postmark (API or authenticated SMTP), verified domain with **SPF, DKIM, DMARC** (start `p=none`, move to `quarantine`), dedicated sending subdomain, bounce and complaint webhooks suppressing addresses, **unsubscribe** (List-Unsubscribe header plus preference) for overdue reminders, plain-text parts kept. | Mailpit proves the flow, not inbox placement. Reminders without an opt-out are a compliance risk. |
| **Backups** | Scheduled Convex snapshot exports (`npx convex export`) to encrypted storage, restore drill quarterly. n8n: Postgres backups (PITR) plus the escrowed n8n encryption key; workflows are reproducible from the repo, credentials from the secret manager. | Convex data is the source of truth; n8n state is mostly rebuildable but its credentials are not without the key. |
| **CSP hardening** | Move to Clerk's `strict` mode (nonce + `strict-dynamic`), add `report-to`/`report-uri` to a collector, run Report-Only first, tighten `connect-src` to the exact production Convex hostnames. | Today the policy is Clerk's default nonce policy plus our directives (ADR-005); reporting finds breakage and injection attempts. |

## P2: scale, data and compliance

| Area | Change | Why |
|---|---|---|
| **Audit log** | Define retention (e.g. 2 years), forbid updates and deletes (no mutation exists today; enforce by code review plus a periodic export to write-once storage such as S3 Object Lock) and add `actorLabel` for every privileged path. | Integrity of the trail is what makes it evidence. |
| **GDPR** | Retention schedule (completed loans anonymized after N months, `workflowErrors` after 30 days, n8n executions already pruned at 168 h); a **Clerk `user.deleted` webhook** to Convex that deletes or anonymizes the user, their tools and loan parties (keep a pseudonymous audit row); export-my-data endpoint; processor list and DPAs; cookie/consent review. Minimization is already done: the webhook carries only the fields in README "Payload minimization". | Right to erasure and portability; reduces breach impact. |
| **Pagination and load** | Replace `take()` caps with `.paginate()` and cursors (ADR-018), add a search index on tool name, and compute availability from a denormalized field (for example `tools.nextAvailableOn`, maintained in the loan mutations) instead of reading loans per tool. Review indexes (`by_tool_status`, `by_status_endDate`) against real query plans. | Caps hide older data and the per-tool loan scan grows with history. |
| **Time zones** | Store a user time zone (from Clerk or profile), evaluate "today", overdue and the 09:00 reminder per recipient, show dates in local time; keep dates as `YYYY-MM-DD` for the booking range. Remove the 1-day tolerance (ADR-006). | UTC days are wrong for users far from UTC; reminders can arrive at the wrong hour. |
| **Backpressure** | Webhook bursts (bulk tool removal cancels many requests, or a seed): n8n queue mode with worker concurrency limits, Convex-side scheduled sending with a global token bucket instead of `runAfter(0)` per event, optional batching of reminders. Respect SMTP provider rate limits. | One event is one HTTP call and one email today; a spike hits SMTP and n8n at once. |
| **Notifications content** | Deep links (needs a new `APP_BASE_URL` Convex env var read through `convex/lib/env.ts`), localized templates, branded HTML emails, reply-to handling. | Plain templates and no links are an MVP choice. |
| **Accessibility** | Automated axe/Playwright runs in CI, manual screen-reader pass (NVDA/VoiceOver), keyboard-only walkthrough of dialogs. | Contrast and semantics were designed for, but not independently audited. |
| **Remove dev surface** | Delete `app/dev/preview` from production builds entirely (it already returns 404 when `NODE_ENV=production`), and drop `http://127.0.0.1:*` from `connect-src` (already gated on `NODE_ENV`). | Smaller attack surface; no fixture code shipped. |

## Known limits and deliberate opt-ins

- **HSTS preload** is a deliberate opt-in (ADR-039): once the production domain is final, add `preload` to the header in `next.config.ts` and submit the domain at hstspreload.org. It is effectively irreversible and covers all subdomains.
- **Overdue scan** reads at most 1000 rows per run (100 loans returned); revisit if more than ~1000 loans can be overdue at once (ADR-035).
- **Bulk operations** (tool removal, auto-decline on approve) are batched at 1000 loans per transaction with scheduled continuations in `convex/maintenance.ts` (ADR-037).
- **Windows hosts:** the bootstrap credentials temp file relies on directory ACLs (no chmod); point `LENDLOOP_TMP` at a directory only your account can read.

## Rotation runbook (summary)

1. Generate new secret (`openssl rand -hex 32`), store in the secret manager.
2. Add it as the second accepted value on the *receiving* side (n8n for HMAC, Convex for bearer).
3. Switch the *sending* side (Convex for HMAC, n8n credential for bearer) and verify with `GET /api/n8n/health` and a test event.
4. Wait for the overlap window (HMAC: 5 min replay window plus in-flight retries; bearer: next WF2 run).
5. Remove the old value, record the rotation in the audit/ops log.

Clerk keys: roll in the Clerk dashboard, update Vercel env, redeploy. The n8n encryption key cannot be rotated in place: re-export credentials, set the new key on a fresh instance, re-run the bootstrap.

## Tool photo hardening
Photos are type, size and magic-byte checked but not re-encoded: add EXIF/GPS stripping and re-encoding (or a malware scan) before opening uploads to untrusted users, and consider a per-user storage quota (see ADR-040).
