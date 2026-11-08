# Deploying LendLoop (reviewer demo)

Targets: Vercel (Next.js app), Convex Cloud (production deployment), the existing Clerk DEV instance (`merry-stinkbug-7434`) on a `*.vercel.app` domain, and Railway (n8n 2.46.6 and Mailpit v1.33.0). Mailpit is the reviewers' email inbox, behind a password. Rationale: ADR-045 to ADR-049 in [DECISIONS.md](DECISIONS.md). This is a demo deployment, not the production target described in [PRODUCTION.md](PRODUCTION.md).

Nothing in this runbook has been executed yet. Items the author could not verify offline are collected in "Unverified items" at the end; check them during the real deploy.

## Architecture

```
Browser --> Vercel (Next.js) --> Convex prod (*.convex.cloud, *.convex.site)
                                   |  HMAC-signed POST          ^ Bearer token (overdue-loans, reminders, errors)
                                   v                            |
                              Railway: n8n (public HTTPS domain, owner login)
                                   | SMTP over private network (mailpit.railway.internal:1025)
                                   v
                              Railway: Mailpit (UI public HTTPS behind basic auth, SMTP private only)
```

## Conventions

- Run everything from the repo root (`D:\Freelance\Fluence International\lendloop`). Quote paths (the parent folder has a space).
- Secrets live in `D:\Freelance\Fluence International\.tmp\deploy-secrets\` (override with `DEPLOY_SECRETS_DIR`). It is outside the repo. Never copy those files into the repo, chat or CI logs.
- The helper scripts in `scripts/deploy/` read secrets from files, pass values on stdin (not in arguments, not through a shell) and print only names and lengths. Every script supports `--dry-run` where it writes anywhere.

## Prerequisites

1. Accounts and CLIs (the operator logs in; scripts never do): `npx convex login`, `npx vercel login` (or a global `vercel`), `railway login`.
2. Railway plan: Hobby (see Limitations). Vercel: Hobby is enough. Convex: free plan is enough.
3. Generate the secrets:

```
node scripts/deploy/gen-secrets.mjs
```

   This creates `webhook_secret`, `inbound_token`, `n8n_encryption_key` and `mailpit_password` (existing files are kept). Back up `n8n_encryption_key` separately (password manager): losing it makes stored n8n credentials unreadable.
4. Add by hand into the same folder, one value per file, no trailing text: `clerk_secret_key` (the `sk_test_...` key of the Clerk dev instance), `clerk_publishable_key` (`pk_test_...`), and later `convex_deploy_key`.
5. Create `deploy.json` in the same folder for non-secret settings (fill in as you learn the values):

```
{
  "DEPLOY_CLERK_JWT_ISSUER_DOMAIN": "https://<your-dev-instance>.clerk.accounts.dev",
  "DEPLOY_N8N_DOMAIN": "<filled in at step 3>",
  "DEPLOY_MAILPIT_DOMAIN": "<filled in at step 2>",
  "DEPLOY_CONVEX_SITE_URL": "https://<prod-deployment>.convex.site",
  "DEPLOY_APP_URL": "https://<project>.vercel.app",
  "DEPLOY_ADMIN_ALERT_EMAIL": "<an address that exists in the demo>",
  "DEPLOY_MAILPIT_USER": "reviewer",
  "DEPLOY_ADMIN_CLERK_USER_IDS": ""
}
```

   Any key can instead be provided as an environment variable of the same name.

## Step 1: Convex production deployment

1. In the Convex dashboard open the LendLoop project and create the production deployment if it does not exist (Production tab). Note its two URLs from Settings: the client URL `https://<name>.convex.cloud` and the HTTP actions URL `https://<name>.convex.site`. Put the `.convex.site` URL into `deploy.json` as `DEPLOY_CONVEX_SITE_URL`.
2. Create a production deploy key (dashboard: Settings, Deploy keys, or `npx convex deployment token create vercel --prod`) and save it to `convex_deploy_key` in the secrets folder. It starts with `prod:`.
3. Clerk issuer: Clerk dashboard (dev instance), Convex integration, copy the Frontend API URL into `DEPLOY_CLERK_JWT_ISSUER_DOMAIN`. It is the same issuer the local dev deployment already uses.
4. The Convex env variables are set at step 4 (they need the n8n domain). The functions are pushed by the Vercel build at step 5 (`npx convex deploy`).

## Step 2: Railway project and Mailpit

```
railway init --name lendloop-demo
railway add --image axllent/mailpit:v1.33.0 --service mailpit
railway service link mailpit
railway volume add --service mailpit --mount-path /data
railway domain --service mailpit --port 8025
```

- Copy the generated host (for example `mailpit-production-xxxx.up.railway.app`) into `deploy.json` as `DEPLOY_MAILPIT_DOMAIN`.
- Do NOT add a TCP proxy or a public domain for port 1025. SMTP is reachable only inside the project at `mailpit.railway.internal:1025`.
- Mailpit needs no Dockerfile: v1.33.0 reads the UI credentials from `MP_UI_AUTH` (`user:password`, space separated for several users), so the password never touches a file or an image layer. The dashboard equivalent of the commands above is: New, Docker Image, `axllent/mailpit:v1.33.0`; Settings, Volumes, mount `/data`; Networking, generate domain, target port 8025.

Set the variables and deploy:

```
node scripts/deploy/railway-env.mjs mailpit --dry-run
node scripts/deploy/railway-env.mjs mailpit
railway service redeploy --service mailpit
```

If the service has not deployed yet, use the dashboard Deploy button instead of `redeploy`. Mailpit binds `[::]:1025` (SMTP) and `[::]:8025` (UI) so both work on Railway's IPv6 private network.

## Step 3: Railway n8n

```
railway add --service n8n
railway domain --service n8n --port 5678
railway volume add --service n8n --mount-path /home/node/.n8n
```

Copy the generated host into `deploy.json` as `DEPLOY_N8N_DOMAIN`. Then:

```
node scripts/deploy/railway-env.mjs n8n --dry-run
node scripts/deploy/railway-env.mjs n8n
railway up --service n8n --detach
```

`railway up` uploads the repo root as the build context (the Dockerfile copies `n8n/workflows/`, `n8n/scripts/bootstrap.mjs` and the entrypoint; `.dockerignore` keeps everything else out) and builds `deploy/railway/n8n/Dockerfile` because `railway-env.mjs` sets `RAILWAY_DOCKERFILE_PATH`. Alternatively connect the GitHub repo in the dashboard and set the same variable.

On every start the entrypoint validates the required env (fails fast with a clear message and no values), imports the credentials from env (rotation by restart), imports the workflows by their fixed ids, publishes them, and then execs the original n8n entrypoint. Watch it with `railway logs --service n8n`; expect `lendloop-entrypoint: env OK`, `Importing credentials ...`, `Publishing workflows ...`, then `Editor is now accessible via`.

First visit to `https://<n8n domain>/`: n8n asks for the owner account. Create it immediately and store the credentials in your password manager. The n8n editor is private to that owner; reviewers do not get access (see "Reviewer access").

## Step 4: Convex production env

```
node scripts/deploy/convex-prod-env.mjs --dry-run
node scripts/deploy/convex-prod-env.mjs
```

This runs `convex env set --prod NAME` per variable with the value on stdin. `ALLOW_SEED_RESET` is never set. If `DEPLOY_ADMIN_CLERK_USER_IDS` is empty the admin variable is skipped (set it after the first sign-in, see Step 7).

## Step 5: Vercel

```
npx vercel link
node scripts/deploy/vercel-env.mjs --dry-run
node scripts/deploy/vercel-env.mjs
npx vercel deploy --prod
```

- `vercel.json` sets the Build Command to `npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`. With `CONVEX_DEPLOY_KEY` (production key) present, `convex deploy` pushes the functions to the production deployment and runs `npm run build` with `NEXT_PUBLIC_CONVEX_URL` set to that deployment (the flag is the default for Next.js projects in Convex 1.49; it is passed explicitly for clarity).
- Do not use `--prebuilt`: the build must run on Vercel so the Convex deploy happens there.
- Put the resulting `https://<project>.vercel.app` into `deploy.json` as `DEPLOY_APP_URL`. Pick a stable project name before sharing the link.
- Do not set `CONVEX_DEPLOY_KEY` for the Preview environment (preview builds would deploy to production).

## Step 6: Seed demo data

The seeding happens after the first successful Vercel build (functions must exist).

Option A, placeholder users (cannot sign in, good for a populated board):

```
npx convex run --prod seed:run '{}'
```

Option B, Clerk test users that can sign in (Clerk TEST keys only; the script refuses anything but `sk_test_`):

```
$env:CLERK_SECRET_KEY = Get-Content "D:\Freelance\Fluence International\.tmp\deploy-secrets\clerk_secret_key" -Raw
$env:SEED_PASSWORD = "<choose a demo password; share it privately with reviewers>"
node scripts/seed-clerk-users.mjs --print
```

`--print` shows the `npx convex run seed:run '...'` command without running it (without `--print` the script would target your dev deployment). Run the printed command with `--prod` appended. Clear the two env vars afterwards (`Remove-Item Env:CLERK_SECRET_KEY, Env:SEED_PASSWORD`). Add `"notify":true` to the seed arguments to enqueue real deliveries for pending requests: n8n will email the recipients into the Mailpit inbox.

`seed:run` refuses to run twice (tools already exist). Resetting needs `ALLOW_SEED_RESET`, which must stay unset in production; only if you deliberately must reset, use `node scripts/deploy/convex-prod-env.mjs --allow-seed-reset`, run `npx convex run --prod seed:reset '{"confirm":"DELETE ALL DEV DATA"}'` until `done: true`, then remove it with `npx convex env remove --prod ALLOW_SEED_RESET`.

## Step 7: Admin, smoke and end-to-end checks

1. Sign in once on the live app, copy your Clerk user id (Clerk dashboard, Users), put it in `deploy.json` as `DEPLOY_ADMIN_CLERK_USER_IDS`, and re-run `node scripts/deploy/convex-prod-env.mjs`. Alternatively `npx convex run --prod admin:promoteToAdmin '{"clerkUserId":"user_..."}'`.
2. Smoke test (public URLs and endpoint auth):

```
node scripts/deploy/smoke-prod.mjs
```

   Expected: app home 200, n8n healthz 200, unsigned webhook 401, overdue-loans without token 401, Convex health with token 200, Mailpit UI and API 401 without auth and 200 with auth, SMTP 1025 not reachable from the internet.
3. End-to-end by hand: sign in as a seeded user, create a tool, request it as another user, then open the Mailpit inbox and confirm the notification email arrived. Check Admin, Automation for the event status (`delivered`). In n8n (owner login) check Executions for "Loan event notification".

## Environment variable matrix

| Service | Variable | Source | Secret |
|---|---|---|---|
| Vercel (Production) | `CONVEX_DEPLOY_KEY` | file `convex_deploy_key` (Convex dashboard or `convex deployment token create`) | yes (sensitive) |
| Vercel (Production) | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | file `clerk_publishable_key` (Clerk dashboard, API keys) | no (public by design) |
| Vercel (Production) | `CLERK_SECRET_KEY` | file `clerk_secret_key` | yes (sensitive) |
| Vercel build | `NEXT_PUBLIC_CONVEX_URL` | injected by `convex deploy` into the build | no |
| Convex prod | `CLERK_JWT_ISSUER_DOMAIN` | setting `DEPLOY_CLERK_JWT_ISSUER_DOMAIN` | no |
| Convex prod | `N8N_WEBHOOK_URL` | `https://<n8n domain>/webhook/lendloop-loan-events` | no |
| Convex prod | `N8N_WEBHOOK_SECRET` | file `webhook_secret` | yes |
| Convex prod | `N8N_INBOUND_TOKEN` | file `inbound_token` | yes |
| Convex prod | `ADMIN_CLERK_USER_IDS` | setting `DEPLOY_ADMIN_CLERK_USER_IDS` | no (ids) |
| Convex prod | `ALLOW_SEED_RESET` | never set in prod by default | no |
| Railway n8n | `RAILWAY_DOCKERFILE_PATH` | fixed `deploy/railway/n8n/Dockerfile` | no |
| Railway n8n | `PORT` | fixed `5678` (Railway also injects it; the entrypoint maps it to `N8N_PORT`) | no |
| Railway n8n | `N8N_PROTOCOL`, `N8N_HOST`, `N8N_WEBHOOK_URL`, `N8N_PROXY_HOPS` | `https`, n8n domain, `https://<n8n domain>/`, `1` | no |
| Railway n8n | `N8N_ENCRYPTION_KEY` | file `n8n_encryption_key` | yes |
| Railway n8n | `LENDLOOP_WEBHOOK_SECRET` | file `webhook_secret` (same as Convex `N8N_WEBHOOK_SECRET`) | yes |
| Railway n8n | `LENDLOOP_INBOUND_TOKEN` | file `inbound_token` (same as Convex `N8N_INBOUND_TOKEN`; becomes the Header Auth credential) | yes |
| Railway n8n | `LENDLOOP_CONVEX_SITE_URL` | setting `DEPLOY_CONVEX_SITE_URL` (https, no trailing slash) | no |
| Railway n8n | `LENDLOOP_MAIL_FROM`, `LENDLOOP_ADMIN_ALERT_EMAIL` | settings `DEPLOY_MAIL_FROM`, `DEPLOY_ADMIN_ALERT_EMAIL` | no |
| Railway n8n | `SMTP_HOST`, `SMTP_PORT` | `mailpit.railway.internal`, `1025` | no |
| Railway n8n | `GENERIC_TIMEZONE` | `UTC` | no |
| Railway Mailpit | `PORT`, `MP_UI_BIND_ADDR` | `8025`, `[::]:8025` | no |
| Railway Mailpit | `MP_SMTP_BIND_ADDR` | `[::]:1025` (private network only) | no |
| Railway Mailpit | `MP_DATABASE`, `MP_MAX_MESSAGES` | `/data/mailpit.db`, `5000` | no |
| Railway Mailpit | `MP_UI_AUTH` | `<DEPLOY_MAILPIT_USER>:<file mailpit_password>` | yes |

The n8n entrypoint also defaults `NODE_FUNCTION_ALLOW_BUILTIN=crypto`, `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (the signature Code node reads `LENDLOOP_WEBHOOK_SECRET`, ADR-025), telemetry off, and execution pruning (7 days, successful runs not saved). `N8N_SECURE_COOKIE` is left at n8n's default (true).

## Rotating secrets

| Secret | Procedure |
|---|---|
| Webhook secret | `node scripts/deploy/gen-secrets.mjs --rotate webhook_secret`, then `convex-prod-env.mjs`, `railway-env.mjs n8n`, `railway service redeploy --service n8n`. In-flight events can fail with 401 for a moment (401 is permanent in the retry policy); re-drive them from Admin, Failed notifications. |
| Inbound token | `--rotate inbound_token`, then `convex-prod-env.mjs`, `railway-env.mjs n8n`, redeploy n8n (the credential is re-imported at start). |
| Mailpit password | `--rotate mailpit_password`, `railway-env.mjs mailpit`, redeploy Mailpit, share the new password privately. |
| Clerk keys | Roll in the Clerk dashboard, update the files, `vercel-env.mjs --replace`, `npx vercel deploy --prod`. |
| Convex deploy key | Create a new key, replace the file, `vercel-env.mjs --replace`, delete the old key in the dashboard. |
| n8n encryption key | Cannot be rotated in place. A different key makes n8n refuse to start against the existing volume. Use a fresh volume (delete and recreate the n8n volume), then re-do the owner setup. `gen-secrets.mjs` requires `--i-know-n8n-key-breaks-credentials`. |

## Reviewer access

Share privately (never in the repo, README or issues):

- App: `https://<project>.vercel.app` (placeholder in the README until deployed).
- Sign up: any email works in a Clerk dev instance. Emails containing `+clerk_test` (for example `reviewer+clerk_test@example.com`) never send mail and accept the verification code `424242`. Real addresses receive a real code. Seeded Clerk users, if created, share the demo password you chose.
- Mailpit inbox: `https://<mailpit domain>/`, user `reviewer` (or `DEPLOY_MAILPIT_USER`), password from the file `mailpit_password`. All notification emails and reminders land there. Messages are capped at 5000.
- n8n editor: `https://<n8n domain>/` is private to the owner account you created. Reviewers are not given a login. The workflow definitions are in `n8n/workflows/` and `n8n/README.md`.

## Limitations

- Clerk dev instance: development keys, a "Development mode" banner, a cap of 100 users, and no production-grade rate limits or bot protection. Fine for a reviewer demo on `*.vercel.app`; ADR-049. The production gap (own domain, Clerk production instance) stays in [PRODUCTION.md](PRODUCTION.md).
- Cost: Railway Hobby is a paid plan (about 5 USD per month including 5 USD usage credit); n8n and Mailpit with volumes should stay within it. Shut down or delete the Railway project after the review to stop billing. Vercel Hobby and Convex free tiers are enough.
- n8n encryption key as a Railway env var: local Docker uses a secret file (`N8N_ENCRYPTION_KEY_FILE`); Railway has no file-mounted secrets, so the key is an env var visible to project members and to the process environment (ADR-046).
- The n8n credentials are re-imported at each start; editing them in the n8n UI does not persist across restarts.
- Mailpit stores real recipient emails in a volume with a single shared password; acceptable for demo data only.
- n8n runs with the internal JS task runner (deprecation notice in logs); the Python runner is unavailable and not used.

## Unverified items (check during the real deploy)

1. Railway volume ownership: the n8n image runs as `node` (uid 1000). If n8n logs permission errors on `/home/node/.n8n`, set the service variable `RAILWAY_RUN_UID=0` (volume owned by root) and redeploy.
2. `railway add --image`, `railway domain --port`, `railway volume add --service` and `railway service redeploy` flags were taken from `--help` of CLI 5.71; the volume `--service` option is documented as a service ID, so use the ID from `railway service list --json` if the name is rejected.
3. Mailpit `/readyz` behaviour behind `MP_UI_AUTH` is unknown: do not configure a Railway health check on Mailpit unless it returns 200 without auth.
4. Whether `MP_UI_AUTH` applies to `/api/v1/*` as well as the UI (the docs say "web UI and API"); `smoke-prod.mjs` asserts a 401 on `/api/v1/info`.
5. `npx convex deployment token create <name> --prod` exact syntax and `convex env set --prod NAME` reading the value from stdin (documented in `convex env set --help`; the first set is the proof).
6. Vercel CLI: `env add NAME production --sensitive --yes` with stdin (vercel CLI is not installed locally, so its flags were not checked); `vercel env rm NAME production --yes` for `--replace`.
7. n8n first start: `import:credentials`, `import:workflow` and `publish:workflow` ran cleanly on a fresh database in a local container with dummy env (verified), but not yet on a Railway volume. After the owner is created, confirm the three workflows are Active in the editor.
8. Convex preview of the HTTP actions CSP and Clerk dev origin: Clerk dev instances accept any origin, but confirm sign-in works on the final `*.vercel.app` URL (and add it to Clerk allowed redirect URLs if prompted).
9. `convex deploy` run inside the Vercel build needs the production deploy key to be valid for the production deployment named in the Convex project; a wrong key fails the build before `next build`.
