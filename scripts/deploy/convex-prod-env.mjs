#!/usr/bin/env node
// Sets the Convex PRODUCTION deployment env via `convex env set --prod NAME` with the value on stdin
// (no shell, nothing in args or shell history). Prints names and lengths only.
//   CLERK_JWT_ISSUER_DOMAIN  setting DEPLOY_CLERK_JWT_ISSUER_DOMAIN (e.g. https://merry-stinkbug-7434.clerk.accounts.dev)
//   N8N_WEBHOOK_URL          https://<DEPLOY_N8N_DOMAIN>/webhook/lendloop-loan-events
//   N8N_WEBHOOK_SECRET       file webhook_secret
//   N8N_INBOUND_TOKEN        file inbound_token
//   ADMIN_CLERK_USER_IDS     setting DEPLOY_ADMIN_CLERK_USER_IDS (optional; skipped when empty)
// ALLOW_SEED_RESET is never set here. Pass --allow-seed-reset only for a deliberate, temporary seed (see DEPLOY.md);
// remove it afterwards with: npx convex env remove --prod ALLOW_SEED_RESET
// Usage: node scripts/deploy/convex-prod-env.mjs [--dry-run] [--allow-seed-reset]
// Requires `npx convex login` and a linked project (CONVEX_DEPLOYMENT in .env.local points at dev; --prod selects prod).
import { existsSync } from "node:fs";
import { checkSecretShape, convexBin, describe, fail, readSecret, requireSetting, run, setting } from "./_lib.mjs";

const dry = process.argv.includes("--dry-run");
const allowSeed = process.argv.includes("--allow-seed-reset");

const issuer = requireSetting("DEPLOY_CLERK_JWT_ISSUER_DOMAIN", "Clerk dashboard > Convex integration (Frontend API URL).");
checkSecretShape("DEPLOY_CLERK_JWT_ISSUER_DOMAIN", issuer, { https: true });
const n8nDomain = requireSetting("DEPLOY_N8N_DOMAIN", "The public Railway domain of the n8n service, without scheme.");
if (/[/:]/.test(n8nDomain)) fail("DEPLOY_N8N_DOMAIN must be a bare host name (no scheme, no path)");

const webhookSecret = readSecret("webhook_secret");
const inboundToken = readSecret("inbound_token");
checkSecretShape("webhook_secret", webhookSecret, { min: 32 });
checkSecretShape("inbound_token", inboundToken, { min: 32 });

const vars = [
  ["CLERK_JWT_ISSUER_DOMAIN", issuer],
  ["N8N_WEBHOOK_URL", `https://${n8nDomain}/webhook/lendloop-loan-events`],
  ["N8N_WEBHOOK_SECRET", webhookSecret],
  ["N8N_INBOUND_TOKEN", inboundToken],
];
const admins = setting("DEPLOY_ADMIN_CLERK_USER_IDS");
if (admins) vars.push(["ADMIN_CLERK_USER_IDS", admins]);
else console.log("note: DEPLOY_ADMIN_CLERK_USER_IDS is empty; ADMIN_CLERK_USER_IDS skipped (set it after the first sign-in, then re-run).");
if (allowSeed) vars.push(["ALLOW_SEED_RESET", "true"]);

if (!existsSync(convexBin)) fail(`local Convex CLI not found at ${convexBin}; run npm ci first`);

let failures = 0;
for (const [name, value] of vars) {
  if (dry) {
    console.log(`[dry-run] would set ${describe(name, value)} on Convex prod`);
    continue;
  }
  const res = run(process.execPath, [convexBin, "env", "set", "--prod", name], { input: value, capture: true });
  if (res.status === 0) console.log(`set ${describe(name, value)}`);
  else {
    failures++;
    // Convex CLI errors do not echo the value; still print only the first lines.
    console.error(`FAILED ${name}: ${res.stderr.split("\n").slice(0, 3).join(" | ")}`);
  }
}
if (failures) fail(`${failures} variable(s) failed`);
console.log(dry ? "Dry run complete." : "Convex prod env updated. Verify with: npx convex env list --prod (prints values; do not share the output).");
