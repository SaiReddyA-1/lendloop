#!/usr/bin/env node
// Generates the production secrets into the secrets dir (outside the repo), mode 0600, one file each:
//   webhook_secret      -> Convex N8N_WEBHOOK_SECRET and n8n LENDLOOP_WEBHOOK_SECRET (64 hex)
//   inbound_token       -> Convex N8N_INBOUND_TOKEN and n8n LENDLOOP_INBOUND_TOKEN   (64 hex)
//   n8n_encryption_key  -> n8n N8N_ENCRYPTION_KEY                                     (64 hex)
//   mailpit_password    -> Mailpit UI password (shared privately with reviewers)       (48 hex)
// Existing files are NEVER overwritten unless named in --rotate. Values are never printed, only names and lengths.
// Usage: node scripts/deploy/gen-secrets.mjs [--rotate webhook_secret,inbound_token,mailpit_password]
//        [--rotate n8n_encryption_key --i-know-n8n-key-breaks-credentials]
// Secrets dir: DEPLOY_SECRETS_DIR, default D:\Freelance\Fluence International\.tmp\deploy-secrets
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, fail, secretsDir } from "./_lib.mjs";

const SPECS = [
  ["webhook_secret", 32],
  ["inbound_token", 32],
  ["n8n_encryption_key", 32],
  ["mailpit_password", 24],
];

const argv = process.argv.slice(2);
const rotateIdx = argv.indexOf("--rotate");
const rotate = new Set(rotateIdx >= 0 ? (argv[rotateIdx + 1] ?? "").split(",").filter(Boolean) : []);
for (const name of rotate) if (!SPECS.some(([n]) => n === name)) fail(`unknown secret name for --rotate: ${name}`);
if (rotate.has("n8n_encryption_key") && !argv.includes("--i-know-n8n-key-breaks-credentials")) {
  fail(
    "rotating n8n_encryption_key makes the existing n8n database unreadable (n8n refuses to start). " +
      "Only do it on a fresh n8n volume; pass --i-know-n8n-key-breaks-credentials to confirm.",
  );
}

mkdirSync(secretsDir, { recursive: true });
console.log(`Secrets dir: ${secretsDir}`);
for (const [name, bytes] of SPECS) {
  const path = join(secretsDir, name);
  const existed = existsSync(path);
  if (existed && !rotate.has(name)) {
    console.log(`  kept     ${name}`);
    continue;
  }
  const value = randomBytes(bytes).toString("hex");
  writeFileSync(path, value, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows: ACL inherited from the parent folder; keep the folder private to your account.
  }
  console.log(`  ${existed ? "rotated  " : "created  "} ${describe(name, value)}`);
}
console.log("Done. Add by hand (never in the repo): clerk_secret_key, clerk_publishable_key, convex_deploy_key.");
console.log("Optional deploy.json (non-secret settings) goes in the same folder; see docs/DEPLOY.md.");
