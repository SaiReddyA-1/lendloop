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

/** Minimum length for shared secrets/tokens. Anything shorter is treated as NOT configured (fail closed). */
export const MIN_SECRET_LENGTH = 32;

/** Shared secret used to HMAC-sign outbound webhooks. Empty string = not configured (or shorter than 32 chars). */
export function n8nWebhookSecret(): string {
  // eslint-disable-next-line @convex-dev/no-process-env -- centralized env access (see file header)
  const value = process.env.N8N_WEBHOOK_SECRET ?? "";
  return value.length >= MIN_SECRET_LENGTH ? value : "";
}

/** Bearer token n8n must present on inbound `/api/n8n/*` calls. Empty string = not configured (or shorter than 32 chars). */
export function n8nInboundToken(): string {
  // eslint-disable-next-line @convex-dev/no-process-env -- centralized env access (see file header)
  const value = process.env.N8N_INBOUND_TOKEN ?? "";
  return value.length >= MIN_SECRET_LENGTH ? value : "";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal", "[::1]"]);

/**
 * The webhook carries PII (recipient email/name), so it must travel over TLS: `https:` always,
 * plain `http:` only for loopback / docker-host names used in local development.
 */
export function isAllowedWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/** Clerk issuer URL; tokenIdentifier = `${issuer}|${clerkUserId}`. Used by the seed to map real Clerk logins. */
export function clerkJwtIssuerDomain(): string {
  // eslint-disable-next-line @convex-dev/no-process-env -- centralized env access (see file header)
  return process.env.CLERK_JWT_ISSUER_DOMAIN ?? "";
}

/** Dev-only guard for `seed:reset`. Must be exactly "true"; never set it on a production deployment. */
export function allowSeedReset(): boolean {
  // eslint-disable-next-line @convex-dev/no-process-env -- centralized env access (see file header)
  return process.env.ALLOW_SEED_RESET === "true";
}
