#!/usr/bin/env node
// Sets Railway service variables with `railway variable set --stdin KEY` (value on stdin, one call per variable;
// `--stdin` verified in `railway variable set --help` for CLI 5.71). Prints names and lengths only.
// Usage: node scripts/deploy/railway-env.mjs <mailpit|n8n|all> [--dry-run] [--deploy]
//   Variables are set with --skip-deploys; the services are deployed afterwards (railway up) unless you want
//   Railway to redeploy on change (--deploy removes --skip-deploys).
// Settings (env or deploy.json in the secrets dir):
//   DEPLOY_N8N_DOMAIN (required for n8n), DEPLOY_CONVEX_SITE_URL (https://<deployment>.convex.site),
//   DEPLOY_MAILPIT_USER (default "reviewer"), DEPLOY_MAIL_FROM (default "LendLoop <noreply@lendloop.example>"),
//   DEPLOY_ADMIN_ALERT_EMAIL (required for n8n), DEPLOY_RAILWAY_N8N_SERVICE (default "n8n"),
//   DEPLOY_RAILWAY_MAILPIT_SERVICE (default "mailpit"), DEPLOY_RAILWAY_ENVIRONMENT (default: linked environment)
// Secrets come from the secrets dir files: n8n_encryption_key, webhook_secret, inbound_token, mailpit_password.
import { checkSecretShape, describe, fail, readSecret, requireSetting, run, setting } from "./_lib.mjs";

const target = process.argv[2];
const dry = process.argv.includes("--dry-run");
const deploy = process.argv.includes("--deploy");
if (!["mailpit", "n8n", "all"].includes(target ?? "")) fail("usage: railway-env.mjs <mailpit|n8n|all> [--dry-run] [--deploy]");

const n8nService = setting("DEPLOY_RAILWAY_N8N_SERVICE") || "n8n";
const mailpitService = setting("DEPLOY_RAILWAY_MAILPIT_SERVICE") || "mailpit";
const environment = setting("DEPLOY_RAILWAY_ENVIRONMENT");
const mailpitUser = setting("DEPLOY_MAILPIT_USER") || "reviewer";
if (!/^[A-Za-z0-9_-]{1,32}$/.test(mailpitUser)) fail("DEPLOY_MAILPIT_USER must be 1-32 chars of A-Z a-z 0-9 _ -");

function planMailpit() {
  const password = readSecret("mailpit_password");
  checkSecretShape("mailpit_password", password, { min: 24 });
  if (!/^[A-Za-z0-9]+$/.test(password)) fail("mailpit_password must be alphanumeric (MP_UI_AUTH is space and colon separated)");
  return {
    service: mailpitService,
    vars: [
      // PORT is the public HTTP port Railway routes to; the UI binds to it. SMTP stays private (no TCP proxy, no domain).
      ["PORT", "8025"],
      ["MP_UI_BIND_ADDR", "[::]:8025"],
      ["MP_SMTP_BIND_ADDR", "[::]:1025"],
      ["MP_DATABASE", "/data/mailpit.db"],
      ["MP_MAX_MESSAGES", "5000"],
      ["MP_UI_AUTH", `${mailpitUser}:${password}`],
    ],
  };
}

function planN8n() {
  const domain = requireSetting("DEPLOY_N8N_DOMAIN", "Run `railway domain -s n8n -p 5678` first and copy the host.");
  if (/[/:]/.test(domain)) fail("DEPLOY_N8N_DOMAIN must be a bare host name");
  const convexSite = requireSetting("DEPLOY_CONVEX_SITE_URL", "e.g. https://<deployment>.convex.site");
  checkSecretShape("DEPLOY_CONVEX_SITE_URL", convexSite, { https: true });
  const alertEmail = requireSetting("DEPLOY_ADMIN_ALERT_EMAIL");
  const mailFrom = setting("DEPLOY_MAIL_FROM") || "LendLoop <noreply@lendloop.example>";
  const encKey = readSecret("n8n_encryption_key");
  const webhookSecret = readSecret("webhook_secret");
  const inboundToken = readSecret("inbound_token");
  checkSecretShape("n8n_encryption_key", encKey, { min: 32 });
  checkSecretShape("webhook_secret", webhookSecret, { min: 32 });
  checkSecretShape("inbound_token", inboundToken, { min: 32 });
  return {
    service: n8nService,
    vars: [
      ["RAILWAY_DOCKERFILE_PATH", "deploy/railway/n8n/Dockerfile"],
      ["PORT", "5678"],
      ["N8N_PROTOCOL", "https"],
      ["N8N_HOST", domain],
      ["N8N_WEBHOOK_URL", `https://${domain}/`],
      ["N8N_PROXY_HOPS", "1"],
      ["GENERIC_TIMEZONE", "UTC"],
      ["N8N_ENCRYPTION_KEY", encKey],
      ["LENDLOOP_WEBHOOK_SECRET", webhookSecret],
      ["LENDLOOP_INBOUND_TOKEN", inboundToken],
      ["LENDLOOP_CONVEX_SITE_URL", convexSite.replace(/\/+$/, "")],
      ["LENDLOOP_MAIL_FROM", mailFrom],
      ["LENDLOOP_ADMIN_ALERT_EMAIL", alertEmail],
      ["SMTP_HOST", `${mailpitService}.railway.internal`],
      ["SMTP_PORT", "1025"],
    ],
  };
}

const plans = [];
if (target === "mailpit" || target === "all") plans.push(planMailpit());
if (target === "n8n" || target === "all") plans.push(planN8n());

let failures = 0;
for (const { service, vars } of plans) {
  console.log(`Service ${service}:`);
  for (const [name, value] of vars) {
    if (dry) {
      console.log(`  [dry-run] would set ${describe(name, value)}`);
      continue;
    }
    const args = ["variable", "set", "--stdin", "-s", service, ...(environment ? ["-e", environment] : []), ...(deploy ? [] : ["--skip-deploys"]), name];
    const res = run("railway", args, { input: value, capture: true });
    if (res.status === 0) console.log(`  set ${describe(name, value)}`);
    else {
      failures++;
      console.error(`  FAILED ${name}: ${(res.stderr || res.stdout).split("\n").slice(0, 3).join(" | ")}`);
    }
  }
}
if (failures) fail(`${failures} variable(s) failed`);
console.log(dry ? "Dry run complete." : "Railway variables set. Deploy with `railway up` (see docs/DEPLOY.md).");
