#!/bin/sh
# LendLoop n8n start script (Railway). Runs as user `node` under tini.
#   1. validate required env (fail fast, never print values)
#   2. bootstrap: import credentials (from env) + workflows (fixed ids, idempotent) and publish them
#   3. exec the image's original entrypoint (which execs `n8n`)
set -eu

# Railway mounts volumes owned by root. If started as root: give the n8n data dir to `node`,
# then re-exec this script as `node` (busybox su -p keeps the environment). n8n never runs as root.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /home/node/.n8n
  chown -R node:node /home/node/.n8n
  export HOME=/home/node
  exec su -p -s /bin/sh -c "exec /opt/lendloop/entrypoint.sh" node
fi

fail() {
  echo "lendloop-entrypoint: ERROR: $1" >&2
  exit 1
}

require() {
  # $1 = variable name
  eval "val=\${$1:-}"
  [ -n "$val" ] || fail "required env var $1 is not set"
}

min_len() {
  # $1 = variable name, $2 = minimum length
  eval "val=\${$1:-}"
  [ "${#val}" -ge "$2" ] || fail "$1 must be at least $2 characters (got ${#val})"
}

for name in N8N_ENCRYPTION_KEY LENDLOOP_WEBHOOK_SECRET LENDLOOP_INBOUND_TOKEN LENDLOOP_CONVEX_SITE_URL \
  LENDLOOP_MAIL_FROM LENDLOOP_ADMIN_ALERT_EMAIL SMTP_HOST SMTP_PORT; do
  require "$name"
done
min_len LENDLOOP_WEBHOOK_SECRET 32
min_len LENDLOOP_INBOUND_TOKEN 32
min_len N8N_ENCRYPTION_KEY 32

case "$LENDLOOP_CONVEX_SITE_URL" in
  https://*) ;;
  *) fail "LENDLOOP_CONVEX_SITE_URL must start with https://" ;;
esac
case "$LENDLOOP_CONVEX_SITE_URL" in
  */) fail "LENDLOOP_CONVEX_SITE_URL must not end with a slash" ;;
esac
case "$SMTP_PORT" in
  *[!0-9]*) fail "SMTP_PORT must be a number" ;;
esac

# Hosted defaults (explicit env values win). Railway injects PORT and RAILWAY_PUBLIC_DOMAIN.
export N8N_PORT="${N8N_PORT:-${PORT:-5678}}"
export N8N_PROTOCOL="${N8N_PROTOCOL:-https}"
export N8N_PROXY_HOPS="${N8N_PROXY_HOPS:-1}"
if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  export N8N_HOST="${N8N_HOST:-$RAILWAY_PUBLIC_DOMAIN}"
  export N8N_WEBHOOK_URL="${N8N_WEBHOOK_URL:-https://$RAILWAY_PUBLIC_DOMAIN/}"
fi
[ -n "${N8N_HOST:-}" ] || fail "N8N_HOST is not set and RAILWAY_PUBLIC_DOMAIN is empty (generate a Railway domain first)"
[ -n "${N8N_WEBHOOK_URL:-}" ] || fail "N8N_WEBHOOK_URL is not set"
case "$N8N_WEBHOOK_URL" in
  https://*/) ;;
  *) fail "N8N_WEBHOOK_URL must be https://<domain>/ (with trailing slash)" ;;
esac
export NODE_FUNCTION_ALLOW_BUILTIN="${NODE_FUNCTION_ALLOW_BUILTIN:-crypto}"
export N8N_BLOCK_ENV_ACCESS_IN_NODE="${N8N_BLOCK_ENV_ACCESS_IN_NODE:-false}"
export N8N_DIAGNOSTICS_ENABLED="${N8N_DIAGNOSTICS_ENABLED:-false}"
export N8N_PERSONALIZATION_ENABLED="${N8N_PERSONALIZATION_ENABLED:-false}"
export N8N_VERSION_NOTIFICATIONS_ENABLED="${N8N_VERSION_NOTIFICATIONS_ENABLED:-false}"
export EXECUTIONS_DATA_PRUNE="${EXECUTIONS_DATA_PRUNE:-true}"
export EXECUTIONS_DATA_MAX_AGE="${EXECUTIONS_DATA_MAX_AGE:-168}"
export EXECUTIONS_DATA_SAVE_ON_SUCCESS="${EXECUTIONS_DATA_SAVE_ON_SUCCESS:-none}"
export GENERIC_TIMEZONE="${GENERIC_TIMEZONE:-UTC}"
export TZ="${TZ:-$GENERIC_TIMEZONE}"

# Bootstrap: temp credentials dir lives under /tmp and is removed by bootstrap.mjs (and again here as a safety net).
export LENDLOOP_TMP="${LENDLOOP_TMP:-/tmp}"
export LENDLOOP_BOOTSTRAP_AT_START=1
export N8N_CMD=n8n
export WORKFLOWS_DIR="${WORKFLOWS_DIR:-/opt/lendloop/workflows}"
cleanup() {
  rm -rf "$LENDLOOP_TMP"/lendloop-creds-* 2>/dev/null || true
}
trap cleanup EXIT
cleanup

echo "lendloop-entrypoint: env OK (secrets present, lengths validated); bootstrapping credentials and workflows"
if ! node /opt/lendloop/bootstrap.mjs; then
  fail "bootstrap failed (see n8n output above); refusing to start without credentials and workflows"
fi
cleanup
trap - EXIT

echo "lendloop-entrypoint: starting n8n on port $N8N_PORT"
exec /docker-entrypoint.sh "$@"
