# LendLoop n8n bootstrap (credentials from env, workflows import + publish).
#   .\bootstrap.ps1            docker mode (runs inside the compose `n8n` container)
#   .\bootstrap.ps1 -Local     local npm n8n (N8N_CMD, default "npx n8n")
# Required: $env:LENDLOOP_INBOUND_TOKEN. Optional: SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_SECURE
param([switch]$Local)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not $env:LENDLOOP_INBOUND_TOKEN) { throw "Set LENDLOOP_INBOUND_TOKEN (same value as Convex N8N_INBOUND_TOKEN)" }

if ($Local) {
  if (-not $env:N8N_CMD) { $env:N8N_CMD = "npx n8n" }
  if (-not $env:SMTP_HOST) { $env:SMTP_HOST = "127.0.0.1" }
  node scripts/bootstrap.mjs
  exit $LASTEXITCODE
}

docker compose exec -T `
  -e LENDLOOP_INBOUND_TOKEN `
  -e SMTP_HOST -e SMTP_PORT -e SMTP_USER -e SMTP_PASSWORD -e SMTP_SECURE `
  -e WORKFLOWS_DIR=/workflows `
  n8n node /scripts/bootstrap.mjs
exit $LASTEXITCODE
