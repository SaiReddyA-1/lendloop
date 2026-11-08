#!/usr/bin/env node
// Generates n8n/workflows/*.json from n8n/code/*.js (Code node sources) so the long jsCode strings stay
// reviewable as real files. Output contains NO secrets: credentials are {id,name} references only.
// Usage: node n8n/scripts/build-workflows.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = (name) => readFileSync(join(root, "code", name), "utf8");

// Fixed ids so `settings.errorWorkflow` and credential references survive import on any instance.
export const IDS = {
  wf1: "lendloopWf01",
  wf2: "lendloopWf02",
  wf99: "lendloopWf99",
  smtp: "lendloopSmtp01",
  inbound: "lendloopInbound1",
};
const SMTP = { smtp: { id: IDS.smtp, name: "LendLoop SMTP" } };
const INBOUND = { httpHeaderAuth: { id: IDS.inbound, name: "LendLoop Convex inbound" } };

// Deterministic UUIDs (n8n node ids) so regenerating does not churn the diff.
const uuid = (seed) => {
  const h = createHash("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

function node(wf, name, type, typeVersion, position, parameters, extra = {}) {
  return { parameters, id: uuid(`${wf}:${name}`), name, type, typeVersion, position, ...extra };
}
const sticky = (wf, name, position, width, height, content, color = 4) =>
  node(wf, name, "n8n-nodes-base.stickyNote", 1, position, { content, height, width, color });

const conn = (from, ...outputs) => [from, { main: outputs.map((o) => o.map((n) => ({ node: n, type: "main", index: 0 }))) }];
const connections = (...pairs) => Object.fromEntries(pairs);

const ifBool = (wf, name, position, expr, operation) =>
  node(wf, name, "n8n-nodes-base.if", 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
      conditions: [
        {
          id: uuid(`${wf}:${name}:cond`),
          leftValue: expr,
          rightValue: "",
          operator: { type: "boolean", operation, singleValue: true },
        },
      ],
      combinator: "and",
    },
    options: {},
  });

const respond = (wf, name, position, code_, body) =>
  node(wf, name, "n8n-nodes-base.respondToWebhook", 1.5, position, {
    respondWith: "json",
    responseBody: body,
    options: { responseCode: code_ },
  });

const email = (wf, name, position, to, extra = {}) =>
  node(
    wf,
    name,
    "n8n-nodes-base.emailSend",
    2.1,
    position,
    {
      fromEmail: "={{ $env.LENDLOOP_MAIL_FROM }}",
      toEmail: to,
      subject: "={{ $json.subject }}",
      emailFormat: "both",
      text: "={{ $json.text }}",
      html: "={{ $json.html }}",
      options: { appendAttribution: false },
    },
    { credentials: SMTP, ...RETRY, onError: "continueErrorOutput", ...extra },
  );

const convexPost = (wf, name, position, path, bodyExpr, extra = {}) =>
  node(
    wf,
    name,
    "n8n-nodes-base.httpRequest",
    4.2,
    position,
    {
      method: "POST",
      url: `={{ $env.LENDLOOP_CONVEX_SITE_URL }}${path}`,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: bodyExpr,
      options: { timeout: 10000 },
    },
    { credentials: INBOUND, ...RETRY, ...extra },
  );

const settingsBase = { executionOrder: "v1" };

// ---------------------------------------------------------------- Workflow 1
function wf1() {
  const w = "wf1";
  const nodes = [
    sticky(
      w,
      "Note: purpose",
      [-160, -120],
      560,
      420,
      "## LendLoop - Loan event notification\n" +
        "Convex POSTs a signed JSON event; this workflow verifies it, emails the recipient and answers.\n\n" +
        "**Responses**: 200 `delivered` / `duplicate`, 401 `invalid_signature`, 502 `email_failed` (Convex retries 408/429/5xx with backoff, other 4xx are permanent).\n\n" +
        "**Needs env**: `LENDLOOP_WEBHOOK_SECRET`, `LENDLOOP_MAIL_FROM`, `NODE_FUNCTION_ALLOW_BUILTIN=crypto`.\n" +
        "**Needs credential**: SMTP `LendLoop SMTP`.\n" +
        "**Dedupe**: eventIds already emailed are kept in workflow static data (newest 500; production executions only).\n" +
        "Error workflow: `LendLoop - Error handler`. Never log payloads (PII).",
    ),
    node(w, "Webhook", "n8n-nodes-base.webhook", 2.1, [0, 400], {
      httpMethod: "POST",
      path: "lendloop-loan-events",
      responseMode: "responseNode",
      options: { rawBody: true },
    }, { webhookId: uuid("wf1:webhook") }),
    node(w, "Verify signature", "n8n-nodes-base.code", 2, [240, 400], {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode: code("verify-signature.js"),
    }),
    ifBool(w, "Signature valid?", [480, 400], "={{ $json.valid }}", "true"),
    respond(w, "Respond 401", [720, 640], 401, '={"error":"invalid_signature"}'),
    ifBool(w, "Already processed?", [720, 400], "={{ $json.duplicate }}", "true"),
    respond(w, "Respond duplicate", [960, 280], 200, '={"status":"duplicate"}'),
    node(w, "Compose email", "n8n-nodes-base.code", 2, [960, 480], {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode: code("compose-email.js"),
    }),
    email(w, "Send email", [1200, 480], "={{ $json.to }}"),
    node(w, "Record event", "n8n-nodes-base.code", 2, [1440, 400], {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode: code("record-event.js"),
    }),
    respond(w, "Respond delivered", [1680, 400], 200, '={"status":"delivered"}'),
    respond(w, "Respond 502", [1440, 600], 502, '={"status":"email_failed"}'),
  ];
  return {
    id: IDS.wf1,
    name: "LendLoop · Loan event notification",
    nodes,
    connections: connections(
      conn("Webhook", ["Verify signature"]),
      conn("Verify signature", ["Signature valid?"]),
      conn("Signature valid?", ["Already processed?"], ["Respond 401"]),
      conn("Already processed?", ["Respond duplicate"], ["Compose email"]),
      conn("Compose email", ["Send email"]),
      conn("Send email", ["Record event"], ["Respond 502"]),
      conn("Record event", ["Respond delivered"]),
    ),
    settings: { ...settingsBase, errorWorkflow: IDS.wf99, saveDataSuccessExecution: "none" },
  };
}

// ---------------------------------------------------------------- Workflow 2
function wf2() {
  const w = "wf2";
  const nodes = [
    sticky(
      w,
      "Note: purpose",
      [-160, -120],
      600,
      380,
      "## LendLoop - Overdue reminders\n" +
        "Daily 09:00 (workflow timezone = `GENERIC_TIMEZONE`): fetch overdue approved loans from Convex, email each borrower, record the outcome.\n\n" +
        "The reminder key is `<loanId>:<date>` computed by Convex, so a second run the same day sends nothing (the overdue list excludes loans already reminded) and a duplicate POST returns `duplicate`.\n\n" +
        "**Needs env**: `LENDLOOP_CONVEX_SITE_URL`, `LENDLOOP_MAIL_FROM`.\n" +
        "**Needs credentials**: Header Auth `LendLoop Convex inbound` (Authorization: Bearer ...), SMTP `LendLoop SMTP`.\n" +
        "Use the Manual Trigger for demos. If the email fails after retries the outcome `failed` is recorded for the day.",
    ),
    node(w, "Every day 09:00", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 300], {
      rule: { interval: [{ field: "cronExpression", expression: "0 9 * * *" }] },
    }),
    node(w, "Manual trigger (demo)", "n8n-nodes-base.manualTrigger", 1, [0, 480], {}),
    node(
      w,
      "Get overdue loans",
      "n8n-nodes-base.httpRequest",
      4.2,
      [240, 400],
      {
        method: "GET",
        url: "={{ $env.LENDLOOP_CONVEX_SITE_URL }}/api/n8n/overdue-loans",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        options: { timeout: 10000 },
      },
      { credentials: INBOUND, ...RETRY },
    ),
    node(w, "Split loans", "n8n-nodes-base.splitOut", 1, [480, 400], {
      fieldToSplitOut: "loans",
      include: "noOtherFields",
      options: {},
    }),
    node(w, "Compose reminder", "n8n-nodes-base.code", 2, [720, 400], {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode: code("compose-reminder.js"),
    }),
    email(w, "Send reminder", [960, 400], "={{ $json.to }}"),
    node(w, "Outcome: sent", "n8n-nodes-base.set", 3.4, [1200, 320], {
      assignments: {
        assignments: [
          { id: uuid("wf2:sent:loan"), name: "loanId", value: "={{ $('Compose reminder').item.json.loanId }}", type: "string" },
          { id: uuid("wf2:sent:out"), name: "outcome", value: "sent", type: "string" },
        ],
      },
      options: {},
    }),
    node(w, "Outcome: failed", "n8n-nodes-base.set", 3.4, [1200, 520], {
      assignments: {
        assignments: [
          { id: uuid("wf2:failed:loan"), name: "loanId", value: "={{ $('Compose reminder').item.json.loanId }}", type: "string" },
          { id: uuid("wf2:failed:out"), name: "outcome", value: "failed", type: "string" },
        ],
      },
      options: {},
    }),
    convexPost(
      w,
      "Record reminder",
      [1440, 400],
      "/api/n8n/reminders",
      "={{ JSON.stringify({ loanId: $json.loanId, reminderDate: $('Get overdue loans').first().json.date, outcome: $json.outcome }) }}",
      // One bad loan (e.g. 409: returned mid-run, 404: deleted) must not abort the remaining reminders.
      // Retries (3 tries, for 5xx/network) still run first; after the last failure the item continues so the loop
      // finishes. Trade-off: a Convex outage while recording is not an execution error (the Get overdue loans
      // step still is, and fires the error workflow); a missed record means that loan may be reminded again on the
      // next run the same day. Use Convex data (reminders table) as the source of truth.
      { onError: "continueRegularOutput" },
    ),
  ];
  return {
    id: IDS.wf2,
    name: "LendLoop · Overdue reminders",
    nodes,
    connections: connections(
      conn("Every day 09:00", ["Get overdue loans"]),
      conn("Manual trigger (demo)", ["Get overdue loans"]),
      conn("Get overdue loans", ["Split loans"]),
      conn("Split loans", ["Compose reminder"]),
      conn("Compose reminder", ["Send reminder"]),
      conn("Send reminder", ["Outcome: sent"], ["Outcome: failed"]),
      conn("Outcome: sent", ["Record reminder"]),
      conn("Outcome: failed", ["Record reminder"]),
    ),
    settings: { ...settingsBase, errorWorkflow: IDS.wf99, saveDataSuccessExecution: "none" },
  };
}

// ---------------------------------------------------------------- Workflow 99
function wf99() {
  const w = "wf99";
  const nodes = [
    sticky(
      w,
      "Note: purpose",
      [-160, -120],
      560,
      340,
      "## LendLoop - Error handler\n" +
        "Set as `errorWorkflow` of the other LendLoop workflows. Builds a SAFE summary (no payload, emails/tokens redacted, 300 chars) and\n" +
        "1. emails the admin (`LENDLOOP_ADMIN_ALERT_EMAIL`),\n" +
        "2. POSTs it to Convex `/api/n8n/automation-events` (shown in the admin dashboard).\n\n" +
        "**Needs env**: `LENDLOOP_ADMIN_ALERT_EMAIL`, `LENDLOOP_MAIL_FROM`, `LENDLOOP_CONVEX_SITE_URL`.\n" +
        "**Needs credentials**: SMTP `LendLoop SMTP`, Header Auth `LendLoop Convex inbound`.",
    ),
    node(w, "Error Trigger", "n8n-nodes-base.errorTrigger", 1, [0, 300], {}),
    node(w, "Summarize", "n8n-nodes-base.code", 2, [240, 300], {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode: code("summarize-error.js"),
    }),
    email(w, "Alert admin", [480, 200], "={{ $env.LENDLOOP_ADMIN_ALERT_EMAIL }}", { onError: "continueRegularOutput" }),
    convexPost(w, "Report to Convex", [480, 400], "/api/n8n/automation-events", "={{ JSON.stringify($json.event) }}"),
  ];
  return {
    id: IDS.wf99,
    name: "LendLoop · Error handler",
    nodes,
    connections: connections(
      conn("Error Trigger", ["Summarize"]),
      conn("Summarize", ["Alert admin", "Report to Convex"]),
    ),
    settings: { ...settingsBase },
  };
}

const outDir = join(root, "workflows");
mkdirSync(outDir, { recursive: true });
const files = {
  "01-loan-event-notification.json": wf1(),
  "02-overdue-reminders.json": wf2(),
  "99-error-handler.json": wf99(),
};
for (const [file, wf] of Object.entries(files)) {
  const full = { ...wf, active: false, tags: [] };
  writeFileSync(join(outDir, file), JSON.stringify(full, null, 2) + "\n");
  console.log("wrote", file);
}
