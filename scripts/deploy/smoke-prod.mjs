#!/usr/bin/env node
// Black-box smoke checks against the deployed stack. Prints check names and HTTP status codes only.
// Settings (env or deploy.json in the secrets dir): DEPLOY_APP_URL (https://<app>.vercel.app),
//   DEPLOY_N8N_DOMAIN, DEPLOY_MAILPIT_DOMAIN, DEPLOY_CONVEX_SITE_URL, DEPLOY_MAILPIT_USER (default "reviewer").
// Secrets (files): inbound_token, mailpit_password.
// Checks:
//   app home 200 | n8n /healthz 200 | unsigned loan-event webhook 401 | Convex overdue-loans without token 401
//   Convex health with token 200 | Mailpit UI without auth 401, with auth 200 | Mailpit SMTP port 1025 not reachable publicly
// Usage: node scripts/deploy/smoke-prod.mjs
import { connect } from "node:net";
import { fail, readSecret, requireSetting, setting } from "./_lib.mjs";

const app = requireSetting("DEPLOY_APP_URL").replace(/\/+$/, "");
const n8n = requireSetting("DEPLOY_N8N_DOMAIN");
const mailpit = requireSetting("DEPLOY_MAILPIT_DOMAIN");
const convexSite = requireSetting("DEPLOY_CONVEX_SITE_URL").replace(/\/+$/, "");
const mailpitUser = setting("DEPLOY_MAILPIT_USER") || "reviewer";
const inboundToken = readSecret("inbound_token");
const mailpitPassword = readSecret("mailpit_password");
for (const u of [app, convexSite]) if (!u.startsWith("https://")) fail(`${u} must be https://`);

const results = [];
function record(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
}

async function expectStatus(name, url, init, expected) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });
    record(name, res.status === expected, `got ${res.status}, want ${expected}`);
  } catch (err) {
    record(name, false, `request failed: ${err instanceof Error ? err.name : "error"}`);
  }
}

function smtpPublic(host, port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 5000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

const basic = "Basic " + Buffer.from(`${mailpitUser}:${mailpitPassword}`).toString("base64");

await expectStatus("app home", `${app}/`, {}, 200);
await expectStatus("n8n healthz", `https://${n8n}/healthz`, {}, 200);
await expectStatus(
  "unsigned loan-event webhook rejected",
  `https://${n8n}/webhook/lendloop-loan-events`,
  { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  401,
);
await expectStatus("overdue-loans without token", `${convexSite}/api/n8n/overdue-loans`, {}, 401);
await expectStatus("convex health with token", `${convexSite}/api/n8n/health`, { headers: { Authorization: `Bearer ${inboundToken}` } }, 200);
await expectStatus("mailpit UI without auth", `https://${mailpit}/`, {}, 401);
await expectStatus("mailpit API without auth", `https://${mailpit}/api/v1/info`, {}, 401);
await expectStatus("mailpit UI with auth", `https://${mailpit}/`, { headers: { Authorization: basic } }, 200);
const exposed = await smtpPublic(mailpit, 1025);
record("mailpit SMTP 1025 not public", !exposed, exposed ? "port is reachable from the internet" : "not reachable");

const failed = results.filter((ok) => !ok).length;
console.log(failed ? `${failed} of ${results.length} checks FAILED` : `All ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
