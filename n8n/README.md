# LendLoop automation (n8n)

Three workflows, generated from `n8n/code/*.js` by `node n8n/scripts/build-workflows.mjs` into `n8n/workflows/`:

| File | Workflow | Trigger |
|---|---|---|
| `01-loan-event-notification.json` | Loan event notification | Webhook `POST /webhook/lendloop-loan-events` (signed by Convex) |
| `02-overdue-reminders.json` | Overdue reminders | Daily 09:00 (cron) + manual trigger for demos |
| `99-error-handler.json` | Error handler | Error Trigger (set as `errorWorkflow` of 01 and 02) |

Workflow ids are fixed (`lendloopWf01`, `lendloopWf02`, `lendloopWf99`) and credential ids too (`lendloopSmtp01`, `lendloopInbound1`), so references survive import. Exports contain no secrets (`npm run scan:secrets` enforces it).

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `N8N_ENCRYPTION_KEY_FILE` | n8n | Path of a Docker secret (`/run/secrets/n8n_encryption_key`, from `n8n/secrets/n8n_encryption_key`) holding the key that encrypts stored credentials. NOT an env var / not in `.env`, so it is not visible via `$env`, `docker inspect` or `/proc/*/environ`. Back it up. |
| `LENDLOOP_WEBHOOK_SECRET` | n8n | HMAC secret; equals Convex `N8N_WEBHOOK_SECRET` |
| `LENDLOOP_CONVEX_SITE_URL` | n8n | Convex HTTP base (`http://127.0.0.1:3211` local, `host.docker.internal:3211` from Docker, `https://<name>.convex.site` prod) |
| `LENDLOOP_MAIL_FROM`, `LENDLOOP_ADMIN_ALERT_EMAIL` | n8n | Sender / error alert recipient |
| `GENERIC_TIMEZONE` | n8n | Timezone of the 09:00 schedule (workflows do not set their own) |
| `NODE_FUNCTION_ALLOW_BUILTIN=crypto` | n8n | Lets the Code node `require('crypto')` |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | n8n | Lets nodes read `$env.LENDLOOP_*` (the Code node needs `LENDLOOP_WEBHOOK_SECRET`). Trade-off: editors can read all env (ADR-025); the encryption key is excluded because it is a secret file |
| `N8N_SECURE_COOKIE` (compose default `false`) | n8n | LOCAL HTTP only; set `true` (and `N8N_PROTOCOL=https`) behind HTTPS |
| `LENDLOOP_INBOUND_TOKEN`, `SMTP_HOST/PORT/USER/PASSWORD/SECURE` | your shell, for bootstrap only | Become the credentials `LendLoop Convex inbound` (Header Auth `Authorization: Bearer ...`) and `LendLoop SMTP` |
| Convex: `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `N8N_INBOUND_TOKEN` | Convex env | See `convex.env.example` |

Generate secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Setup with Docker (Mailpit included)

```bash
cd n8n
cp .env.example .env                # fill LENDLOOP_WEBHOOK_SECRET
mkdir -p secrets && printf %s "$(openssl rand -hex 32)" > secrets/n8n_encryption_key   # encryption key as a Docker secret file, NOT in .env
docker compose up -d
export LENDLOOP_INBOUND_TOKEN=...   # same as Convex N8N_INBOUND_TOKEN
./scripts/bootstrap.sh              # Windows: .\scripts\bootstrap.ps1
docker compose restart n8n          # required, see gotchas
```

Then set on Convex: `npx convex env set N8N_WEBHOOK_URL http://localhost:5678/webhook/lendloop-loan-events` plus the two secrets. UI: n8n http://localhost:5678, Mailpit http://localhost:8025.

## Setup without Docker (npm n8n)

```bash
npm i n8n@2.46.6            # in a separate folder, not in the repo
export N8N_USER_FOLDER=... NODE_FUNCTION_ALLOW_BUILTIN=crypto N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
       N8N_SECURE_COOKIE=false LENDLOOP_WEBHOOK_SECRET=... LENDLOOP_CONVEX_SITE_URL=http://127.0.0.1:3211 \
       LENDLOOP_MAIL_FROM="LendLoop <noreply@example.com>" LENDLOOP_ADMIN_ALERT_EMAIL=admin@example.com
export LENDLOOP_INBOUND_TOKEN=... SMTP_HOST=127.0.0.1 SMTP_PORT=1025
N8N_CMD="npx n8n" ./n8n/scripts/bootstrap.sh --local     # or .\n8n\scripts\bootstrap.ps1 -Local (run from the n8n install folder)
# If any path contains spaces, use N8N_BIN instead (runs n8n with node, no shell):
#   N8N_BIN="/path/to/n8n-install/node_modules/n8n/bin/n8n" node n8n/scripts/bootstrap.mjs
npx n8n start
```

Any SMTP catcher on 127.0.0.1:1025 works (Mailpit binary, MailHog, `smtp-sink`). Leave SMTP user/password empty for catchers.

## Demo with Mailpit

1. `docker compose up -d`, bootstrap, restart (above), Convex env set.
2. `npx convex run seed:run` (or `node scripts/seed-clerk-users.mjs` for real Clerk test users). The pending request emits `request_created`; open http://localhost:8025: the owner email is there.
3. Approve/decline/return in the app: one mail per event.
4. Overdue demo: open n8n, workflow "Overdue reminders", **Execute workflow** (manual trigger): one mail per overdue borrower; run again: none (idempotent).
5. Failure demo: `docker compose stop mailpit`, trigger an event; Convex shows it retrying; `docker compose start mailpit`: the retry delivers.

## Credentials, import, publish

`scripts/bootstrap.mjs` writes a credentials JSON to a temp dir (mode 0600) built from env, runs `import:credentials`, deletes it, runs `import:workflow --separate`, then `publish:workflow --id=...` for each file. Nothing secret is written to the repo.

## Gotchas we actually hit

- **Task runner and `crypto`**: Code nodes run in the task runner; `require('crypto')` needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (internal mode: the main process env is enough).
- **`$env` is blocked by default** in 2.x ("access to env vars denied"); set `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.
- **Raw body**: the Webhook option `rawBody: true` exposes the exact bytes as binary property `data`; read with `await this.helpers.getBinaryDataBuffer(0, 'data')`. Verifying a re-serialised `$json.body` would break the signature.
- **Publish vs active**: in 2.x use `publish:workflow`; the production URL `/webhook/...` only exists for published workflows, and the CLI says "restart n8n for changes to take effect". Before the restart the webhook returned 404 (Convex marks that permanent failure: re-trigger after fixing).
- **Windows import path**: `import:workflow --separate --input=<dir>` found 0 workflows with backslashes; the bootstrap normalises to forward slashes.
- **Static data** (event de-dupe) persists only for production (published) executions, not manual test runs.
- **`n8n execute` while an instance runs** fails with "Task Broker's port 5679 is already in use": set `N8N_RUNNERS_BROKER_PORT=5689` for the CLI process.
- **Retry wait is fixed**: node retries are 3 x 5 s; the exponential backoff (30 s, 2 min, 8 min, 30 min) is Convex's.
- **Timeout alignment**: n8n email retries can take >10 s, so Convex `DELIVERY_TIMEOUT_MS` is 30 s (ADR-028).
- **Timezone**: the schedule follows `GENERIC_TIMEZONE`; overdue dates are computed in UTC by Convex (ADR-006).
- **`N8N_SECURE_COOKIE=false`** is needed to log in over plain `http://localhost`; never in production.
- **Docker** was not available on the development machine, so `docker-compose.yml` and the container bootstrap path are untested here; the local npm path is what `E2E-RESULTS.md` verified.

## Re-exporting after UI edits

`n8n export:workflow --backup --output=<dir>`, copy back, then remove `pinData`, `meta.instanceId`, and anything under a node's `credentials` other than `{id,name}`, run `npm run scan:secrets`. Prefer editing `n8n/code/*.js` / `build-workflows.mjs` and regenerating.
