#!/usr/bin/env bash
# LendLoop n8n bootstrap (credentials from env, workflows import + publish).
#   ./bootstrap.sh            docker mode: runs inside the compose `n8n` container
#   ./bootstrap.sh --local    local npm n8n (N8N_CMD, default "npx n8n"; run `n8n start` separately)
# Required: LENDLOOP_INBOUND_TOKEN. Optional: SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_SECURE
set -euo pipefail
cd "$(dirname "$0")/.."   # n8n/
: "${LENDLOOP_INBOUND_TOKEN:?Set LENDLOOP_INBOUND_TOKEN (same value as Convex N8N_INBOUND_TOKEN)}"

if [ "${1:-}" = "--local" ]; then
  export N8N_CMD="${N8N_CMD:-npx n8n}"
  export SMTP_HOST="${SMTP_HOST:-127.0.0.1}"
  exec node scripts/bootstrap.mjs
fi

# Git Bash (MSYS) rewrites arguments that look like POSIX paths (/scripts/...) into C:/Program Files/Git/...; disable that.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
# Docker: pass secrets per-exec (-e NAME without value forwards our env); they are not stored in the container.
exec docker compose exec -T \
  -e LENDLOOP_INBOUND_TOKEN \
  -e SMTP_HOST -e SMTP_PORT -e SMTP_USER -e SMTP_PASSWORD -e SMTP_SECURE \
  -e WORKFLOWS_DIR=/workflows \
  n8n node /scripts/bootstrap.mjs
