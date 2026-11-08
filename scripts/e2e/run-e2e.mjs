#!/usr/bin/env node
// End-to-end API test of LendLoop against the REAL local stack (no mocks): local Convex, n8n, SMTP capture sink.
// Not part of `npm run check` (needs the live stack). Run: npm run e2e:api
//
// Config (env, all optional):
//   E2E_INBOX_DIR            dir where the SMTP sink writes .eml files
//   E2E_N8N_URL              n8n base URL                      (default http://127.0.0.1:5678)
//   E2E_CONVEX_SITE_URL      Convex HTTP actions base URL      (default http://127.0.0.1:3211)
//   E2E_APP_URL              Next.js dev server                (default http://localhost:3000)
//   E2E_INBOUND_TOKEN_FILE   file holding N8N_INBOUND_TOKEN    (fallback: `convex env get`)
//   E2E_WEBHOOK_SECRET_FILE  file holding N8N_WEBHOOK_SECRET   (fallback: `convex env get`)
//   E2E_N8N_ENV_FILE         bash file to source before `n8n execute` (step 10; sets N8N_RUNTIME_DIR, broker port)
//   E2E_BASH                 bash executable for step 10
// Secrets are never printed. Destructive: step 1 wipes ALL app data on the dev deployment (seed:reset).
import { execFile, spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const e2eDir = path.resolve(repo, "..", ".tmp", "e2e");
const INBOX = process.env.E2E_INBOX_DIR ?? path.join(e2eDir, "inbox");
const N8N = (process.env.E2E_N8N_URL ?? "http://127.0.0.1:5678").replace(/\/$/, "");
const SITE = (process.env.E2E_CONVEX_SITE_URL ?? "http://127.0.0.1:3211").replace(/\/$/, "");
const APP = (process.env.E2E_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const N8N_ENV_FILE = process.env.E2E_N8N_ENV_FILE ?? path.join(e2eDir, "n8n-env.sh");
const CONVEX_BIN = path.join(repo, "node_modules", "convex", "bin", "main.js");
const WEBHOOK_URL = `${N8N}/webhook/lendloop-loan-events`;

const RUN = Date.now().toString(36);
const results = [];
let emailsBefore = 0;

// ---------------------------------------------------------------- helpers
function record(step, name, ok, evidence) {
  results.push({ step, name, ok, evidence });
  console.log(`${ok === "SKIP" ? "SKIP" : ok ? "PASS" : "FAIL"}  ${step}  ${name}  ${evidence ?? ""}`);
}
const check = (step, name, cond, evidence) => record(step, name, !!cond, evidence);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Calls a Convex function through the local CLI. Returns { ok, data, code, text }. */
async function cx(fn, args = {}, identity) {
  const argv = [CONVEX_BIN, "run", fn, JSON.stringify(args), "--typecheck", "disable", "--codegen", "disable"];
  if (identity) argv.push("--identity", JSON.stringify(identity));
  try {
    const { stdout } = await execFileP(process.execPath, argv, { cwd: repo, maxBuffer: 16 << 20, timeout: 120_000 });
    const t = stdout.trim();
    let data;
    try {
      data = t === "" ? null : JSON.parse(t);
    } catch {
      data = t;
    }
    return { ok: true, data, text: t };
  } catch (e) {
    const text = `${e.stderr ?? ""}${e.stdout ?? ""}`;
    const m = /"code":"([A-Z_]+)"/.exec(text);
    const code = m ? m[1] : /ArgumentValidationError|Validator:/.test(text) ? "ARG_VALIDATION" : "ERROR";
    return { ok: false, code, text: text.slice(0, 400) };
  }
}
const inlineQuery = async (src) => {
  const argv = [CONVEX_BIN, "run", "--inline-query", src, "--typecheck", "disable", "--codegen", "disable"];
  const { stdout } = await execFileP(process.execPath, argv, { cwd: repo, maxBuffer: 16 << 20, timeout: 120_000 });
  return JSON.parse(stdout.trim());
};
async function convexEnv(name) {
  const { stdout } = await execFileP(process.execPath, [CONVEX_BIN, "env", "get", name], { cwd: repo });
  return stdout.trim();
}
async function secret(fileEnv, convexName, defaultFile) {
  const file = process.env[fileEnv] ?? defaultFile;
  if (file && existsSync(file)) return readFileSync(file, "utf8").trim();
  return convexEnv(convexName);
}

const ident = (key, name, email) => ({
  subject: `user_e2e_${key}`,
  issuer: "https://e2e.local",
  tokenIdentifier: `https://e2e.local|user_e2e_${key}`,
  name,
  email,
});
const OWNER = ident("owner", "Olivia Owner", "olivia.owner@example.com");
const BORROWER = ident("borrower", "Ben Borrower", "ben.borrower@example.com");
const STRANGER = ident("stranger", "Sam Stranger", "sam.stranger@example.com");
const ADMIN = ident("admin", "Ada Admin", "ada.admin@example.com");

// ---- SMTP inbox (.eml files written by the capture sink)
const emlCache = new Map();
function readInbox() {
  if (!existsSync(INBOX)) return [];
  const out = [];
  for (const f of readdirSync(INBOX)) {
    if (!f.toLowerCase().endsWith(".eml")) continue;
    if (!emlCache.has(f)) {
      const raw = readFileSync(path.join(INBOX, f), "utf8");
      const [head, ...rest] = raw.split(/\r?\n\r?\n/);
      const unfolded = head.replace(/\r?\n(?=[ \t])/g, "");
      const hdr = (n) => new RegExp(`^${n}:\\s*(.*)$`, "im").exec(unfolded)?.[1]?.trim() ?? "";
      emlCache.set(f, { file: f, subject: decodeWord(hdr("Subject")), to: hdr("To").toLowerCase(), body: rest.join("\n\n") });
    }
    out.push(emlCache.get(f));
  }
  return out;
}
function decodeWord(s) {
  return s.replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_, enc, txt) =>
    enc.toLowerCase() === "b" ? Buffer.from(txt, "base64").toString("utf8") : txt.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))),
  );
}
/** Waits for an email to `to` whose subject contains `subj` (string or RegExp). */
async function waitEmail(to, subj, ms = 25_000) {
  const end = Date.now() + ms;
  const match = (m) => (!to || m.to.includes(to.toLowerCase())) && (subj instanceof RegExp ? subj.test(m.subject) : m.subject.includes(subj));
  do {
    const hit = readInbox().find(match);
    if (hit) return hit;
    await sleep(500);
  } while (Date.now() < end);
  return null;
}
const countEmails = (to, subj) =>
  readInbox().filter((m) => (!to || m.to.includes(to.toLowerCase())) && (subj instanceof RegExp ? subj.test(m.subject) : m.subject.includes(subj))).length;

/** Waits for the newest automationEvent of `type` on a loan (as `who`) to reach `delivered`. */
async function waitEvent(loanId, type, who, ms = 25_000) {
  const end = Date.now() + ms;
  let last = "none";
  do {
    const r = await cx("automation:listForLoans", { loanIds: [loanId] }, who);
    const ev = r.ok ? (r.data?.[loanId] ?? []).find((e) => e.type === type) : undefined;
    last = ev ? ev.status : "none";
    if (last === "delivered") return last;
    await sleep(1000);
  } while (Date.now() < end);
  return last;
}

async function ensure(who) {
  const r = await cx("users:ensureCurrent", {}, who);
  const me = await cx("users:me", {}, who);
  return { r, me };
}

// ---------------------------------------------------------------- scenario
const ctxData = {};

async function step1() {
  let done = false;
  for (let i = 0; i < 20 && !done; i++) {
    const r = await cx("seed:reset", { confirm: "DELETE ALL DEV DATA" });
    if (!r.ok) {
      check("1", "seed:reset", false, r.text);
      return;
    }
    done = r.data.done;
  }
  check("1", "seed:reset completes", done, "wiped dev data");
  const s = await cx("seed:run", {});
  check("1", "seed:run counts", s.ok && s.data.users === 8 && s.data.tools === 27 && s.data.loans === 17, JSON.stringify(s.data ?? s.text));
  const pub = await cx("tools:listPublic", {});
  const rows = pub.data ?? [];
  const names = rows.map((r) => r.name);
  check("1", "listPublic only {name,category}", rows.length > 0 && rows.every((r) => Object.keys(r).sort().join() === "category,name"), `${rows.length} rows`);
  check("1", "listPublic names unique, removed tool hidden", new Set(names).size === names.length && !names.includes("Soldering station"), "");
  ctxData.seedNames = names;
  try {
    const res = await fetch(`${APP}/`);
    const html = await res.text();
    const hit = names.find((n) => html.includes(n.replace(/&/g, "&amp;")));
    check("1", "GET / (Next.js) shows a seeded tool name", res.status === 200 && !!hit, `status ${res.status}, found "${hit}"`);
  } catch (e) {
    check("1", "GET / (Next.js) shows a seeded tool name", false, String(e.message));
  }
}

async function step2() {
  let allOk = true;
  const ids = {};
  for (const [k, who] of Object.entries({ owner: OWNER, borrower: BORROWER, stranger: STRANGER, admin: ADMIN })) {
    const { r, me } = await ensure(who);
    ids[k] = me.data?._id;
    const keys = Object.keys(me.data ?? {}).sort().join();
    const clean = keys === "_id,email,name,role,trustedLender" && !/tokenIdentifier|clerkUserId/.test(JSON.stringify(me.data));
    allOk &&= r.ok && clean && me.data.role === "user";
  }
  ctxData.ids = ids;
  check("2", "4 identities provisioned, users:me is own projection only", allOk, `keys: _id,email,name,role,trustedLender`);
  const noauth = await cx("users:me", {});
  check("2", "users:me signed out returns null", noauth.ok && noauth.data === null, "");
  const p = await cx("admin:promoteToAdmin", { clerkUserId: "user_e2e_admin", reason: "e2e" });
  const meA = await cx("users:me", {}, ADMIN);
  check("2", "admin promoted via internal admin:promoteToAdmin", p.ok && meA.data?.role === "admin", `role=${meA.data?.role}`);
}

async function step3() {
  const mk = (name) => cx("tools:create", { name, category: "power_tools", condition: "good", description: "E2E test tool" }, OWNER);
  ctxData.t1Name = `E2E Drill ${RUN}`;
  ctxData.t2Name = `E2E Saw ${RUN}`;
  ctxData.t3Name = `E2E Ladder ${RUN}`;
  const [t1, t2, t3] = [await mk(ctxData.t1Name), await mk(ctxData.t2Name), await mk(ctxData.t3Name)];
  ctxData.t1 = t1.data;
  ctxData.t2 = t2.data;
  ctxData.t3 = t3.data;
  check("3", "owner lists 3 tools", t1.ok && t2.ok && t3.ok, `ids ${[t1.data, t2.data, t3.data].map((x) => String(x).slice(0, 6)).join(",")}`);
  const pub = await cx("tools:listPublic", {});
  check("3", "new tool visible in listPublic", (pub.data ?? []).some((t) => t.name === ctxData.t1Name), "");
  const short = await cx("tools:create", { name: "x", category: "garden", condition: "good", description: "d" }, OWNER);
  check("3", "too short name -> VALIDATION", !short.ok && short.code === "VALIDATION", short.code);
  const badCat = await cx("tools:create", { name: "Valid name", category: "nope", condition: "good", description: "d" }, OWNER);
  check("3", "bad category rejected (arg validator)", !badCat.ok && ["VALIDATION", "ARG_VALIDATION"].includes(badCat.code), `${badCat.code} (schema validator rejects before handler)`);
}

async function step4() {
  const dates = { startDate: addDays(20), endDate: addDays(22) };
  const r = await cx("loans:request", { toolId: ctxData.t1, ...dates }, BORROWER);
  ctxData.loanA = r.data;
  check("4", "borrower request -> pending loan id", r.ok && typeof r.data === "string", r.ok ? "created" : r.text);
  const mine = await cx("loans:listMyRequests", {}, BORROWER);
  const row = (mine.data ?? []).find((l) => l._id === ctxData.loanA);
  check("4", "listMyRequests shows pending", row?.status === "pending", `status=${row?.status}`);
  const mail = await waitEmail(OWNER.email, `New borrow request for ${ctxData.t1Name}`);
  check("4", "owner gets 'New borrow request' email within 25 s", !!mail, mail ? mail.subject : "none");
  const st = await waitEvent(ctxData.loanA, "request_created", OWNER);
  check("4", "automationEvent request_created delivered", st === "delivered", st);
}

async function step5() {
  // stranger pending request that overlaps A (created BEFORE A is approved)
  const b = await cx("loans:request", { toolId: ctxData.t1, startDate: addDays(21), endDate: addDays(23) }, STRANGER);
  ctxData.loanB = b.data;
  check("5", "stranger creates overlapping pending request B", b.ok, b.ok ? "created" : b.text);
  const s = await cx("loans:approve", { loanId: ctxData.loanA }, STRANGER);
  check("5", "stranger approving A -> NOT_FOUND", !s.ok && s.code === "NOT_FOUND", s.code);
  const bo = await cx("loans:approve", { loanId: ctxData.loanA }, BORROWER);
  check("5", "borrower approving own request -> NOT_FOUND", !bo.ok && bo.code === "NOT_FOUND", bo.code);
  const own = await cx("loans:request", { toolId: ctxData.t1, startDate: addDays(40), endDate: addDays(41) }, OWNER);
  check("5", "owner borrowing own tool -> VALIDATION", !own.ok && own.code === "VALIDATION", own.code);
  const past = await cx("loans:request", { toolId: ctxData.t2, startDate: addDays(-10), endDate: addDays(-8) }, STRANGER);
  check("5", "past start date -> VALIDATION", !past.ok && past.code === "VALIDATION", past.code);
  const un = await cx("loans:approve", { loanId: ctxData.loanA });
  check("5", "unauthenticated approve -> UNAUTHENTICATED", !un.ok && un.code === "UNAUTHENTICATED", un.code);
  const unr = await cx("loans:request", { toolId: ctxData.t1, startDate: addDays(50), endDate: addDays(51) });
  check("5", "unauthenticated request -> UNAUTHENTICATED", !unr.ok && unr.code === "UNAUTHENTICATED", unr.code);
  const still = await cx("loans:listMyRequests", {}, BORROWER);
  check("5", "A still pending after all rejected attempts", (still.data ?? []).find((l) => l._id === ctxData.loanA)?.status === "pending", "");
}

async function step6() {
  const ap = await cx("loans:approve", { loanId: ctxData.loanA }, OWNER);
  check("6", "owner approves A", ap.ok, ap.ok ? "ok" : ap.text);
  const mail = await waitEmail(BORROWER.email, `Your request for ${ctxData.t1Name} was approved`);
  check("6", "borrower gets 'approved' email", !!mail, mail?.subject ?? "none");
  check("6", "event request_approved delivered", (await waitEvent(ctxData.loanA, "request_approved", BORROWER)) === "delivered", "");
  const mine = await cx("loans:listMyRequests", {}, STRANGER);
  const b = (mine.data ?? []).find((l) => l._id === ctxData.loanB);
  check("6", "overlapping pending B auto-declined", b?.status === "declined", `status=${b?.status}`);
  const mailB = await waitEmail(STRANGER.email, `Your request for ${ctxData.t1Name} was declined`);
  check("6", "stranger gets own 'declined' email", !!mailB, mailB?.subject ?? "none");
  const c = await cx("loans:request", { toolId: ctxData.t1, startDate: addDays(22), endDate: addDays(24) }, STRANGER);
  check("6", "overlapping request after approval -> CONFLICT", !c.ok && c.code === "CONFLICT", c.code);
}

async function step7() {
  const r = await cx("loans:markReturned", { loanId: ctxData.loanA }, OWNER);
  check("7", "owner marks A returned", r.ok, r.ok ? "ok" : r.text);
  const mail = await waitEmail(BORROWER.email, `${ctxData.t1Name} was marked as returned`);
  check("7", "borrower gets 'returned' email", !!mail, mail?.subject ?? "none");
  const again = await cx("loans:markReturned", { loanId: ctxData.loanA }, OWNER);
  check("7", "return twice -> INVALID_TRANSITION", !again.ok && again.code === "INVALID_TRANSITION", again.code);
  const ap = await cx("loans:approve", { loanId: ctxData.loanA }, OWNER);
  check("7", "approve returned loan -> INVALID_TRANSITION", !ap.ok && ap.code === "INVALID_TRANSITION", ap.code);
}

async function step8() {
  const r = await cx("loans:request", { toolId: ctxData.t2, startDate: addDays(10), endDate: addDays(12) }, BORROWER);
  check("8", "borrower requests T2", r.ok, r.ok ? "ok" : r.text);
  await waitEmail(OWNER.email, `New borrow request for ${ctxData.t2Name}`);
  const c = await cx("loans:cancel", { loanId: r.data }, BORROWER);
  check("8", "borrower cancels pending request", c.ok, c.ok ? "ok" : c.text);
  const mail = await waitEmail(OWNER.email, `Request for ${ctxData.t2Name} was cancelled`);
  check("8", "owner gets 'cancelled' email", !!mail, mail?.subject ?? "none");
  const ownerCancel = await cx("loans:cancel", { loanId: r.data }, OWNER);
  check("8", "owner cannot use borrower cancel -> NOT_FOUND", !ownerCancel.ok && ownerCancel.code === "NOT_FOUND", ownerCancel.code);
}

async function step9() {
  const nonAdmin = await cx("admin:listLoans", {}, BORROWER);
  check("9", "non-admin admin:listLoans -> FORBIDDEN", !nonAdmin.ok && nonAdmin.code === "FORBIDDEN", nonAdmin.code);
  const adminOk = await cx("admin:listLoans", {}, ADMIN);
  check("9", "admin admin:listLoans works", adminOk.ok && Array.isArray(adminOk.data), `${adminOk.data?.length} loans`);
  const trust = await cx("admin:setTrustedLender", { userId: ctxData.ids.owner, trusted: true, reason: "e2e trust" }, ADMIN);
  const audit = await cx("admin:listAuditLog", { limit: 20 }, ADMIN);
  const row = (audit.data ?? []).find((a) => a.action === "user.trusted.grant" && a.reason === "e2e trust");
  check("9", "setTrustedLender(owner) writes audit row", trust.ok && !!row, row ? `${row.action} by ${row.actorLabel}` : trust.text);
  const self = await cx("admin:setTrustedLender", { userId: ctxData.ids.admin, trusted: true }, ADMIN);
  check("9", "admin self-trust -> FORBIDDEN", !self.ok && self.code === "FORBIDDEN", self.code);
  const notAdminRemove = await cx("admin:removeTool", { toolId: ctxData.t3, reason: "nope nope" }, STRANGER);
  check("9", "non-admin removeTool -> FORBIDDEN", !notAdminRemove.ok && notAdminRemove.code === "FORBIDDEN", notAdminRemove.code);

  const l3 = await cx("loans:request", { toolId: ctxData.t3, startDate: addDays(5), endDate: addDays(6) }, BORROWER);
  await waitEmail(OWNER.email, `New borrow request for ${ctxData.t3Name}`);
  const rm = await cx("admin:removeTool", { toolId: ctxData.t3, reason: "E2E moderation test" }, ADMIN);
  check("9", "admin removeTool cancels pending loans", l3.ok && rm.ok && rm.data.cancelledLoans === 1, JSON.stringify(rm.data ?? rm.text));
  const mine = await cx("loans:listMyRequests", {}, BORROWER);
  check("9", "pending loan on removed tool is cancelled", (mine.data ?? []).find((l) => l._id === l3.data)?.status === "cancelled", "");
  const mail = await waitEmail(BORROWER.email, `Request for ${ctxData.t3Name} was cancelled`);
  check("9", "borrower gets cancellation email", !!mail, mail?.subject ?? "none");
  const pub = await cx("tools:listPublic", {});
  check("9", "removed tool gone from listPublic", !(pub.data ?? []).some((t) => t.name === ctxData.t3Name), "");
  const audit2 = await cx("admin:listAuditLog", { limit: 20 }, ADMIN);
  check("9", "tool.remove audit row with reason", (audit2.data ?? []).some((a) => a.action === "tool.remove" && a.reason === "E2E moderation test"), "");
}

async function step10() {
  const token = await secret("E2E_INBOUND_TOKEN_FILE", "N8N_INBOUND_TOKEN", path.join(e2eDir, "secrets", "inbound"));
  const auth = { Authorization: `Bearer ${token}` };
  const total = async () => (await inlineQuery('await ctx.db.query("reminders").collect()')).length;
  const overdueNames = ["Pressure washer 130 bar", "Carpet cleaner"];
  const beforeRows = await total();
  const beforeMail = countEmails(null, "Overdue: please return");

  // Runs the n8n CLI directly with node (npx could try to download n8n). Exit 90 = n8n package not on disk.
  const runWf = () => {
    const bash = process.env.E2E_BASH ?? (existsSync("C:\\Program Files\\Git\\bin\\bash.exe") ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash");
    if (!existsSync(N8N_ENV_FILE)) return { status: 91 };
    const envFile = N8N_ENV_FILE.replace(/\\/g, "/");
    const cmd = `source "${envFile}" && B="$N8N_RUNTIME_DIR/node_modules/n8n/bin/n8n" && [ -f "$B" ] || exit 90; cd "$N8N_RUNTIME_DIR" && node "$B" execute --id=lendloopWf02`;
    return spawnSync(bash, ["-c", cmd], { encoding: "utf8", timeout: 180_000 });
  };
  const r1 = runWf();
  if (r1.status === 90 || r1.status === 91) {
    record(
      "10",
      "run WF2 via n8n CLI",
      "SKIP",
      r1.status === 90
        ? "n8n package missing under $N8N_RUNTIME_DIR/node_modules/n8n; manual: source n8n-env.sh; cd $N8N_RUNTIME_DIR; node node_modules/n8n/bin/n8n execute --id=lendloopWf02"
        : "E2E_N8N_ENV_FILE not found",
    );
    // Fallback: exercise the Convex side of the reminder contract (what WF2 calls) without n8n and email.
    const get = async () => (await fetch(`${SITE}/api/n8n/overdue-loans`, { headers: auth })).json();
    const first = await get();
    const names = first.loans.map((l) => l.toolName).sort();
    check("10b", "overdue-loans lists the 2 seeded overdue loans", JSON.stringify(names) === JSON.stringify([...overdueNames].sort()), names.join("; "));
    let created = 0;
    for (const l of first.loans) {
      const r = await fetch(`${SITE}/api/n8n/reminders`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ loanId: l.loanId, reminderDate: first.date, outcome: "sent" }),
      });
      if (r.status === 201) created++;
    }
    const rows1 = await total();
    check("10b", "reminders recorded (201 each, rows +2)", created === 2 && rows1 - beforeRows === 2, `${created} created, +${rows1 - beforeRows} rows`);
    const second = await get();
    check("10b", "second overdue-loans call returns none (idempotent)", second.loans.length === 0 && (await total()) === rows1, `${second.loans.length} loans`);
    return;
  }
  check("10", "n8n execute WF2 (first run) exit 0", r1.status === 0, `exit ${r1.status}`);
  await sleep(2500);
  const rows1 = await total();
  const mails1 = countEmails(null, "Overdue: please return");
  // Pressure washer already has a reminder for YESTERDAY only, so today's run covers both overdue seeded loans.
  const got = overdueNames.filter((n) => readInbox().some((m) => m.subject === `Overdue: please return ${n}`));
  check("10", "reminder emails for seeded overdue loans", got.length === 2 && mails1 - beforeMail === 2, `new emails ${mails1 - beforeMail}: ${got.join("; ")}`);
  check("10", "Convex reminders rows recorded", rows1 - beforeRows === 2, `+${rows1 - beforeRows} rows`);
  const r2 = runWf();
  await sleep(2500);
  const rows2 = await total();
  const mails2 = countEmails(null, "Overdue: please return");
  check("10", "second run idempotent (no new rows/emails)", r2.status === 0 && rows2 === rows1 && mails2 === mails1, `rows ${rows1}->${rows2}, emails ${mails1}->${mails2}`);
}

async function step11() {
  const token = await secret("E2E_INBOUND_TOKEN_FILE", "N8N_INBOUND_TOKEN", path.join(e2eDir, "secrets", "inbound"));
  const auth = { Authorization: `Bearer ${token}` };
  const get = (p, h) => fetch(`${SITE}${p}`, { headers: h });
  check("11", "GET overdue-loans no token -> 401", (await get("/api/n8n/overdue-loans")).status === 401, "");
  check("11", "GET overdue-loans wrong token -> 401", (await get("/api/n8n/overdue-loans", { Authorization: "Bearer wrong-token" })).status === 401, "");
  const ok = await get("/api/n8n/overdue-loans", auth);
  const body = await ok.json().catch(() => ({}));
  check("11", "GET overdue-loans valid token -> 200 JSON {date, loans[]}", ok.status === 200 && Array.isArray(body.loans), `status ${ok.status}, ${body.loans?.length} loans`);
  const post = (obj, raw) => fetch(`${SITE}/api/n8n/reminders`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: raw ?? JSON.stringify(obj) });
  const loans = await inlineQuery('await ctx.db.query("loans").withIndex("by_status_endDate", q => q.eq("status","approved")).take(50)');
  const loan = loans.find((l) => l.endDate < today());
  const payload = { loanId: loan?._id, reminderDate: today(), outcome: "sent" };
  const first = await post(payload);
  const second = await post(payload);
  const sb = await second.json().catch(() => ({}));
  check("11", "POST reminders first -> 200/201 (recorded or already recorded)", [200, 201].includes(first.status), `status ${first.status}`);
  check("11", "POST reminders duplicate -> 200 duplicate", second.status === 200 && sb.status === "duplicate", `status ${second.status} ${JSON.stringify(sb)}`);
  const big = await post(null, JSON.stringify({ loanId: "x".repeat(20_000), reminderDate: today(), outcome: "sent" }));
  check("11", "oversize body -> 413", big.status === 413, `status ${big.status}`);
  const bad = await post({ loanId: "x", reminderDate: "nope", outcome: "sent" });
  check("11", "invalid body -> 400", bad.status === 400, `status ${bad.status}`);
  const m1 = await fetch(`${SITE}/api/n8n/health`, { method: "POST", headers: auth });
  const m2 = await fetch(`${SITE}/api/n8n/overdue-loans`, { method: "PUT", headers: auth });
  check("11", "wrong method -> 405", m1.status === 405 && m2.status === 405, `POST health ${m1.status}, PUT overdue ${m2.status}`);
}

function signedHeaders(secretValue, rawBody, tsOffset = 0, eventId = "e2e") {
  const ts = Math.floor(Date.now() / 1000) + tsOffset;
  const sig = createHmac("sha256", secretValue).update(`${ts}.${rawBody}`).digest("hex");
  return {
    "Content-Type": "application/json",
    "X-LendLoop-Timestamp": String(ts),
    "X-LendLoop-Signature": `sha256=${sig}`,
    "X-LendLoop-Event-Id": eventId,
    "Idempotency-Key": eventId,
  };
}
const sendEvent = (secretValue, payload, { tsOffset = 0, badSig = false } = {}) => {
  const raw = JSON.stringify(payload);
  const headers = signedHeaders(secretValue, raw, tsOffset, payload.eventId);
  if (badSig) headers["X-LendLoop-Signature"] = `sha256=${"0".repeat(64)}`;
  return fetch(WEBHOOK_URL, { method: "POST", headers, body: raw });
};
const evPayload = (id, extra = {}) => ({
  eventId: id,
  eventType: "request_created",
  loanId: "e2e-loan",
  toolName: `E2E Hook ${RUN}`,
  loanStatus: "pending",
  startDate: addDays(60),
  endDate: addDays(61),
  recipient: { name: "Hook Recipient", email: "hook.recipient@example.com" },
  ...extra,
});

async function step12() {
  const sec = await secret("E2E_WEBHOOK_SECRET_FILE", "N8N_WEBHOOK_SECRET", path.join(e2eDir, "secrets", "webhook"));
  const id = `e2e-${RUN}-ok`;
  const r = await sendEvent(sec, evPayload(id));
  const body = await r.text();
  check("12", "valid signed event -> 200 delivered", r.status === 200 && /delivered/.test(body), `status ${r.status} ${body.slice(0, 60)}`);
  const mail = await waitEmail("hook.recipient@example.com", `New borrow request for E2E Hook ${RUN}`);
  check("12", "valid event produced an email", !!mail, mail?.subject ?? "none");
  const rep = await sendEvent(sec, evPayload(id));
  const repBody = await rep.text();
  await sleep(1500);
  check("12", "replay same eventId -> 200 duplicate, no 2nd email", rep.status === 200 && /duplicate/.test(repBody) && countEmails("hook.recipient@example.com", `E2E Hook ${RUN}`) === 1, `status ${rep.status} ${repBody.slice(0, 60)}`);
  const bad = await sendEvent(sec, evPayload(`e2e-${RUN}-bad`), { badSig: true });
  check("12", "bad signature -> 401", bad.status === 401, `status ${bad.status}`);
  const stale = await sendEvent(sec, evPayload(`e2e-${RUN}-stale`), { tsOffset: -400 });
  check("12", "stale timestamp (-400 s) -> 401", stale.status === 401, `status ${stale.status}`);
  await sleep(1000);
  check("12", "rejected events sent no email", countEmails("hook.recipient@example.com", `E2E Hook ${RUN}`) === 1, "");
}

async function step13() {
  const sec = await secret("E2E_WEBHOOK_SECRET_FILE", "N8N_WEBHOOK_SECRET", path.join(e2eDir, "secrets", "webhook"));
  const before = (await cx("admin:listWorkflowErrors", {}, ADMIN)).data?.length ?? 0;
  const mailsBefore = readInbox().length;
  const r = await sendEvent(sec, evPayload(`e2e-${RUN}-unsupported`, { eventType: "totally_unknown" }));
  check("13", "unsupported eventType -> n8n 500", r.status === 500, `status ${r.status}`);
  const known = new Set(readInbox().slice(0, mailsBefore).map((m) => m.file));
  const end = Date.now() + 30_000;
  let alert;
  while (!alert && Date.now() < end) {
    alert = readInbox().find((m) => !known.has(m.file) && /error|fail|alert|workflow/i.test(m.subject));
    if (!alert) await sleep(1000);
  }
  check("13", "admin alert email captured", !!alert, alert ? `subject "${alert.subject}"` : "none");
  let after = before;
  const end2 = Date.now() + 20_000;
  while (after <= before && Date.now() < end2) {
    after = (await cx("admin:listWorkflowErrors", {}, ADMIN)).data?.length ?? 0;
    if (after <= before) await sleep(1500);
  }
  check("13", "admin:listWorkflowErrors gained a row", after > before, `${before} -> ${after}`);
  const nonAdmin = await cx("admin:listWorkflowErrors", {}, BORROWER);
  check("13", "non-admin listWorkflowErrors -> FORBIDDEN", !nonAdmin.ok && nonAdmin.code === "FORBIDDEN", nonAdmin.code);
}

async function step14() {
  const get = (p) => fetch(`${APP}${p}`, { redirect: "manual" });
  for (const p of ["/", "/dev/preview", "/manifest.webmanifest", "/icon.svg"]) {
    const r = await get(p);
    check("14", `GET ${p} -> 200`, r.status === 200, `status ${r.status}`);
  }
  const d = await get("/dashboard");
  record("14", "GET /dashboard signed out (informational)", d.status !== 200 || "SKIP", `status ${d.status}${d.headers.get("location") ? ` -> ${d.headers.get("location")}` : ""}`);
  results[results.length - 1].ok = d.status !== 200 ? true : "INFO";
  results[results.length - 1].evidence += d.status !== 200 ? " (protected when signed out)" : " (NOT protected: 200 while signed out)";
}

// ---------------------------------------------------------------- run
const steps = [step1, step2, step3, step4, step5, step6, step7, step8, step9, step10, step11, step12, step13, step14];
console.log(`LendLoop E2E (run ${RUN}) inbox=${INBOX}`);
if (!existsSync(INBOX)) console.log("WARNING: inbox dir not found; email assertions will fail");
emailsBefore = readInbox().length;
for (const [i, fn] of steps.entries()) {
  try {
    await fn();
  } catch (e) {
    record(String(i + 1), `${fn.name} crashed`, false, String(e?.message ?? e).slice(0, 200));
  }
}
const emailsNew = readInbox().length - emailsBefore;
console.log("\nStep | Result | Check | Evidence");
for (const r of results) console.log(`${r.step} | ${r.ok === true ? "PASS" : r.ok === false ? "FAIL" : r.ok} | ${r.name} | ${r.evidence ?? ""}`);
const failed = results.filter((r) => r.ok === false).length;
console.log(`\n${results.filter((r) => r.ok === true).length} passed, ${failed} failed, emails captured this run: ${emailsNew}`);
process.exit(failed ? 1 : 0);
