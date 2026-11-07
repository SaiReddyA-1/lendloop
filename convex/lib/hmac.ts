// Pure Web Crypto helpers (no env, no db). Used for outbound webhook signing
// and constant-time inbound bearer verification.

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Hex HMAC over `${timestampSec}.${rawBody}`. Header value is `sha256=<hex>`. */
export function signWebhook(secret: string, timestampSec: number, rawBody: string): Promise<string> {
  return hmacSha256Hex(secret, `${timestampSec}.${rawBody}`);
}

/**
 * Constant-time string comparison. Both inputs are first hashed with SHA-256 so
 * the compared buffers always have equal length (no length leak), then every
 * byte is compared without early exit.
 */
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Verifies `Authorization: Bearer <token>`. Fails closed on missing/malformed header or empty expected token. */
export async function verifyBearer(
  authHeader: string | null | undefined,
  expectedToken: string,
): Promise<boolean> {
  if (!expectedToken) return false;
  if (!authHeader) return false;
  const m = /^Bearer (\S+)$/i.exec(authHeader.trim());
  if (!m || !m[1]) return false;
  return timingSafeEqualStr(m[1], expectedToken);
}
