import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { n8nInboundToken } from "./lib/env";
import { verifyBearer } from "./lib/hmac";
import { isIsoDate, todayUtc } from "./lib/dates";
import { OVERDUE_CAP, OVERDUE_PAGE_SIZE, OVERDUE_SCAN_MAX, type OverdueLoan } from "./automation";

// Inbound API for n8n (all under /api/n8n/*). Auth: `Authorization: Bearer <N8N_INBOUND_TOKEN>`,
// compared in constant time. No cookies/CORS: server-to-server only.

const MAX_BODY_BYTES = 16 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Returns an error Response when the caller is not authorized, else null. Fails closed. */
async function authorizeInbound(request: Request): Promise<Response | null> {
  const expected = n8nInboundToken();
  if (!expected) return json(503, { error: "not_configured" });
  const ok = await verifyBearer(request.headers.get("Authorization"), expected);
  return ok ? null : json(401, { error: "unauthorized" });
}

type ParsedBody = { ok: true; data: Record<string, unknown> } | { ok: false; response: Response };

async function readJsonBody(request: Request): Promise<ParsedBody> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) return { ok: false, response: json(413, { error: "too_large" }) };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return { ok: false, response: json(413, { error: "too_large" }) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, response: json(400, { error: "invalid_json" }) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, response: json(400, { error: "invalid_body" }) };
  }
  return { ok: true, data: parsed as Record<string, unknown> };
}

function str(value: unknown, max: number, required: boolean): string | undefined | null {
  // null = invalid, undefined = absent (only when not required)
  if (value === undefined || value === null) return required ? null : undefined;
  if (typeof value !== "string") return null;
  if (required && value.trim().length === 0) return null;
  return value.slice(0, max);
}

/** Walks the overdue range in bounded pages: <= OVERDUE_SCAN_MAX rows scanned, <= OVERDUE_CAP loans returned. */
async function collectOverdue(ctx: ActionCtx): Promise<{ date: string; loans: OverdueLoan[] }> {
  const date = todayUtc();
  const loans: OverdueLoan[] = [];
  let cursor: string | null = null;
  let scanned = 0;
  while (loans.length < OVERDUE_CAP && scanned < OVERDUE_SCAN_MAX) {
    const page: Awaited<ReturnType<typeof runPage>> = await runPage(ctx, date, cursor);
    loans.push(...page.loans.slice(0, OVERDUE_CAP - loans.length));
    scanned += page.scanned;
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return { date, loans };
}

function runPage(ctx: ActionCtx, date: string, cursor: string | null) {
  return ctx.runQuery(internal.automation.overdueLoansPage, {
    date,
    cursor,
    numItems: OVERDUE_PAGE_SIZE,
  });
}

// AUTH: bearer N8N_INBOUND_TOKEN
export const overdueLoans = httpAction(async (ctx, request) => {
  const denied = await authorizeInbound(request);
  if (denied) return denied;
  return json(200, await collectOverdue(ctx));
});

// AUTH: bearer N8N_INBOUND_TOKEN
export const recordReminder = httpAction(async (ctx, request) => {
  const denied = await authorizeInbound(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const { loanId, reminderDate, outcome } = body.data;
  if (
    typeof loanId !== "string" ||
    loanId.length > 64 ||
    typeof reminderDate !== "string" ||
    !isIsoDate(reminderDate) ||
    (outcome !== "sent" && outcome !== "failed")
  ) {
    return json(400, { error: "invalid_body" });
  }
  const res = await ctx.runMutation(internal.automation.recordReminder, {
    loanId,
    reminderDate,
    outcome,
  });
  switch (res.status) {
    case "recorded":
      return json(201, { status: "recorded" });
    case "duplicate":
      return json(200, { status: "duplicate" });
    case "not_found":
      return json(404, { error: "not_found" });
    case "conflict":
      return json(409, { error: "loan_not_approved" });
    default:
      return json(400, { error: "invalid_body" });
  }
});

// AUTH: bearer N8N_INBOUND_TOKEN
export const recordAutomationError = httpAction(async (ctx, request) => {
  const denied = await authorizeInbound(request);
  if (denied) return denied;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const d = body.data;
  const workflowName = str(d.workflowName, 100, true);
  const executionId = str(d.executionId, 64, true);
  const nodeName = str(d.nodeName, 100, false);
  const message = str(d.message, 300, true);
  const loanId = str(d.loanId, 64, false);
  const eventId = str(d.eventId, 64, false);
  if (
    workflowName == null ||
    executionId == null ||
    nodeName === null ||
    message == null ||
    loanId === null ||
    eventId === null
  ) {
    return json(400, { error: "invalid_body" });
  }
  await ctx.runMutation(internal.automation.recordWorkflowError, {
    workflowName,
    executionId,
    ...(nodeName !== undefined ? { nodeName } : {}),
    message,
    ...(loanId !== undefined ? { loanId } : {}),
    ...(eventId !== undefined ? { eventId } : {}),
  });
  return json(201, { status: "recorded" });
});

// AUTH: bearer N8N_INBOUND_TOKEN
export const health = httpAction(async (_ctx, request) => {
  const denied = await authorizeInbound(request);
  if (denied) return denied;
  return json(200, { ok: true });
});

// AUTH: public (returns a bare 405 for unsupported methods; no data, no side effects)
export const methodNotAllowed = httpAction(async () => json(405, { error: "method_not_allowed" }));

const http = httpRouter();
const routes: { path: string; method: "GET" | "POST"; handler: typeof health }[] = [
  { path: "/api/n8n/overdue-loans", method: "GET", handler: overdueLoans },
  { path: "/api/n8n/reminders", method: "POST", handler: recordReminder },
  { path: "/api/n8n/automation-events", method: "POST", handler: recordAutomationError },
  { path: "/api/n8n/health", method: "GET", handler: health },
];
for (const r of routes) {
  http.route({ path: r.path, method: r.method, handler: r.handler });
  for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
    if (m !== r.method) http.route({ path: r.path, method: m, handler: methodNotAllowed });
  }
}

export default http;
