// The ONLY file allowed to read process.env in Convex functions. Keeping env
// access in one place makes the set of runtime secrets/config auditable.

/** Comma-separated Clerk user ids (`user_...`) that are bootstrapped as admins. */
export function adminClerkUserIdsRaw(): string {
  // eslint-disable-next-line @convex-dev/no-process-env -- centralized env access (see file header)
  return process.env.ADMIN_CLERK_USER_IDS ?? "";
}

/** n8n Workflow 1 webhook URL (outbound). Empty string = not configured. */
export function n8nWebhookUrl(): string {
  // eslint-disable-next-line @convex-dev/no-process-env -- centralized env access (see file header)
  return process.env.N8N_WEBHOOK_URL ?? "";
}

/** Shared secret used to HMAC-sign outbound webhooks. Empty string = not configured. */
export function n8nWebhookSecret(): string {
  // eslint-disable-next-line @convex-dev/no-process-env -- centralized env access (see file header)
  return process.env.N8N_WEBHOOK_SECRET ?? "";
}

/** Bearer token n8n must present on inbound `/api/n8n/*` calls. Empty string = not configured. */
export function n8nInboundToken(): string {
  // eslint-disable-next-line @convex-dev/no-process-env -- centralized env access (see file header)
  return process.env.N8N_INBOUND_TOKEN ?? "";
}
