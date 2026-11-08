import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectKeys, makeLoan, makeTool, makeUser, newT, NOW_ISO, TODAY } from "../tests/helpers";

const TOKEN = "inbound-test-token-0123456789abcdef0123456789abcdef"; // scan-secrets:allow test value

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  vi.stubEnv("N8N_INBOUND_TOKEN", TOKEN);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const auth = { Authorization: `Bearer ${TOKEN}` };
const post = (body: unknown, headers: Record<string, string> = auth) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

async function setup() {
  const t = newT();
  const owner = await makeUser(t, "user_owner");
  const borrower = await makeUser(t, "user_borrower");
  await t.run((ctx) => ctx.db.patch("users", borrower._id, { email: "borrower@example.com" }));
  const toolId = await makeTool(t, owner._id);
  const overdue = await makeLoan(t, toolId, owner._id, borrower._id, {
    status: "approved",
    startDate: "2026-11-01",
    endDate: "2026-11-05",
  });
  return { t, owner, borrower, toolId, overdue };
}

describe("inbound auth", () => {
  const routes: [string, string, unknown?][] = [
    ["GET", "/api/n8n/overdue-loans"],
    ["GET", "/api/n8n/health"],
    ["POST", "/api/n8n/reminders", { loanId: "x", reminderDate: TODAY, outcome: "sent" }],
    ["POST", "/api/n8n/automation-events", { workflowName: "w", executionId: "1", message: "m" }],
  ];

  it("401 without or with a wrong token (no detail), with no-store", async () => {
    const t = newT();
    for (const [method, path, body] of routes) {
      const variants: Record<string, string>[] = [
        {},
        { Authorization: "Bearer wrong" },
        { Authorization: TOKEN },
      ];
      for (const headers of variants) {
        const res = await t.fetch(path, {
          method,
          headers,
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        expect(res.status, `${method} ${path}`).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
        expect(res.headers.get("Cache-Control")).toBe("no-store");
      }
    }
  });

  it("503 not_configured when the token is shorter than 32 chars (fails closed even with the matching bearer)", async () => {
    vi.stubEnv("N8N_INBOUND_TOKEN", "short-token-31-chars-aaaaaaaaaa");
    const t = newT();
    const res = await t.fetch("/api/n8n/health", {
      method: "GET",
      headers: { Authorization: "Bearer short-token-31-chars-aaaaaaaaaa" }, // scan-secrets:allow test value
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
  });

  it("503 not_configured when the token env is missing (even with a bearer header)", async () => {
    vi.stubEnv("N8N_INBOUND_TOKEN", "");
    const t = newT();
    const res = await t.fetch("/api/n8n/health", { method: "GET", headers: { Authorization: "Bearer " } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
    const res2 = await t.fetch("/api/n8n/health", { method: "GET", headers: { Authorization: "Bearer x" } });
    expect(res2.status).toBe(503);
  });

  it("health returns ok with a valid token", async () => {
    const res = await newT().fetch("/api/n8n/health", { method: "GET", headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("wrong method -> 405", async () => {
    const t = newT();
    expect((await t.fetch("/api/n8n/health", { method: "POST", headers: auth })).status).toBe(405);
    expect((await t.fetch("/api/n8n/reminders", { method: "GET", headers: auth })).status).toBe(405);
    expect((await t.fetch("/api/n8n/overdue-loans", { method: "DELETE" })).status).toBe(405);
  });
});

describe("GET /api/n8n/overdue-loans", () => {
  it("returns only reminder fields; excludes reminded, non-overdue, non-approved and email-less", async () => {
    const { t, owner, borrower, toolId, overdue } = await setup();
    const noEmail = await makeUser(t, "user_noemail");
    // Not overdue (ends today), pending, no-email borrower, and already reminded today.
    await makeLoan(t, toolId, owner._id, borrower._id, {
      status: "approved",
      startDate: "2026-11-06",
      endDate: TODAY,
    });
    await makeLoan(t, toolId, owner._id, borrower._id, { status: "pending", endDate: "2026-11-01" });
    await makeLoan(t, toolId, owner._id, noEmail._id, {
      status: "approved",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
    });
    const reminded = await makeLoan(t, toolId, owner._id, borrower._id, {
      status: "approved",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
    });
    await t.run((ctx) =>
      ctx.db.insert("reminders", {
        idempotencyKey: `${reminded}:${TODAY}`,
        loanId: reminded,
        reminderDate: TODAY,
        outcome: "sent",
        createdAt: 1,
      }),
    );

    const res = await t.fetch("/api/n8n/overdue-loans", { method: "GET", headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.date).toBe(TODAY);
    expect(body.loans).toEqual([
      {
        loanId: overdue,
        toolName: "Cordless drill",
        borrowerName: "Name user_borrower",
        borrowerEmail: "borrower@example.com",
        endDate: "2026-11-05",
        daysOverdue: 3,
        idempotencyKey: `${overdue}:${TODAY}`,
      },
    ]);
    const keys = collectKeys(body);
    for (const k of ["ownerId", "borrowerId", "clerkUserId", "tokenIdentifier", "description"]) {
      expect(keys.has(k), k).toBe(false);
    }
    expect(JSON.stringify(body)).not.toContain("owner");
  });
});

describe("GET /api/n8n/overdue-loans bounded paging", () => {
  it("already-reminded loans do not starve newer un-reminded ones (spans several pages)", async () => {
    const { t, owner, borrower, toolId } = await setup();
    // 150 OLDEST overdue loans are already reminded today; 5 newer ones are not.
    await t.run(async (ctx) => {
      for (let i = 0; i < 150; i++) {
        const loanId = await ctx.db.insert("loans", {
          toolId,
          ownerId: owner._id,
          borrowerId: borrower._id,
          startDate: "2026-09-01",
          endDate: "2026-09-02",
          status: "approved",
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert("reminders", {
          idempotencyKey: `${loanId}:${TODAY}`,
          loanId,
          reminderDate: TODAY,
          outcome: "sent",
          createdAt: 1,
        });
      }
    });
    const res = await t.fetch("/api/n8n/overdue-loans", { method: "GET", headers: auth });
    const body = await res.json();
    // setup()'s own overdue loan (endDate 2026-11-05) is the newest; no earlier un-reminded loans exist.
    expect(body.loans).toHaveLength(1);
    expect(body.loans[0].endDate).toBe("2026-11-05");
  });

  it("returns at most 100 loans per call", async () => {
    const { t, owner, borrower, toolId } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 120; i++) {
        await ctx.db.insert("loans", {
          toolId,
          ownerId: owner._id,
          borrowerId: borrower._id,
          startDate: "2026-10-01",
          endDate: "2026-10-02",
          status: "approved",
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    const body = await (await t.fetch("/api/n8n/overdue-loans", { method: "GET", headers: auth })).json();
    expect(body.loans).toHaveLength(100);
  });
});

describe("POST /api/n8n/reminders", () => {
  it("is idempotent: second POST -> duplicate, exactly one reminder row and one event", async () => {
    const { t, overdue } = await setup();
    const body = { loanId: overdue, reminderDate: TODAY, outcome: "sent" };
    const r1 = await t.fetch("/api/n8n/reminders", post(body));
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ status: "recorded" });
    const r2 = await t.fetch("/api/n8n/reminders", post({ ...body, outcome: "failed" }));
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ status: "duplicate" });

    const state = await t.run(async (ctx) => ({
      reminders: await ctx.db.query("reminders").collect(),
      events: await ctx.db.query("automationEvents").collect(),
    }));
    expect(state.reminders).toHaveLength(1);
    expect(state.reminders[0]).toMatchObject({
      idempotencyKey: `${overdue}:${TODAY}`,
      outcome: "sent",
    });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      type: "overdue_reminder",
      recipientRole: "borrower",
      status: "delivered",
    });

    // After recording, the loan no longer appears in the overdue list.
    const list = await (await t.fetch("/api/n8n/overdue-loans", { method: "GET", headers: auth })).json();
    expect(list.loans).toEqual([]);
  });

  it("ignores any client-supplied idempotency key; failed outcome -> failed event", async () => {
    const { t, overdue } = await setup();
    const res = await t.fetch(
      "/api/n8n/reminders",
      post({ loanId: overdue, reminderDate: TODAY, outcome: "failed", idempotencyKey: "evil" }),
    );
    expect(res.status).toBe(201);
    const rows = await t.run((ctx) => ctx.db.query("reminders").collect());
    expect(rows[0]?.idempotencyKey).toBe(`${overdue}:${TODAY}`);
    const ev = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(ev[0]).toMatchObject({ status: "failed" });
  });

  it("accepts a reminderDate of yesterday or tomorrow (clock skew tolerance)", async () => {
    const { t, overdue } = await setup();
    for (const d of ["2026-11-07", "2026-11-09"]) {
      const res = await t.fetch("/api/n8n/reminders", post({ loanId: overdue, reminderDate: d, outcome: "sent" }));
      expect(res.status, d).toBe(201);
    }
  });

  it("400 for invalid bodies", async () => {
    const { t, overdue } = await setup();
    const bad: unknown[] = [
      "not json{",
      "[]",
      "null",
      {},
      { loanId: overdue, reminderDate: "2026-02-30", outcome: "sent" },
      { loanId: overdue, reminderDate: "tomorrow", outcome: "sent" },
      { loanId: overdue, reminderDate: "2026-11-06", outcome: "sent" }, // > 1 day in the past
      { loanId: overdue, reminderDate: "2026-11-10", outcome: "sent" }, // > 1 day in the future
      { loanId: overdue, reminderDate: "1999-01-01", outcome: "sent" },
      { loanId: overdue, reminderDate: TODAY, outcome: "maybe" },
      { loanId: 5, reminderDate: TODAY, outcome: "sent" },
      { loanId: "garbage-id", reminderDate: TODAY, outcome: "sent" },
    ];
    for (const b of bad) {
      const res = await t.fetch("/api/n8n/reminders", post(b));
      expect(res.status, JSON.stringify(b)).toBe(400);
    }
    expect(await t.run((ctx) => ctx.db.query("reminders").collect())).toHaveLength(0);
  });

  it("413 for oversize body (before parsing)", async () => {
    const { t, overdue } = await setup();
    const res = await t.fetch(
      "/api/n8n/reminders",
      post({ loanId: overdue, reminderDate: TODAY, outcome: "sent", pad: "x".repeat(17 * 1024) }),
    );
    expect(res.status).toBe(413);
    expect(await t.run((ctx) => ctx.db.query("reminders").collect())).toHaveLength(0);
  });

  it("404 unknown loan; 409 loan not approved", async () => {
    const { t, owner, borrower, toolId, overdue } = await setup();
    await t.run((ctx) => ctx.db.delete("loans", overdue));
    const gone = await t.fetch("/api/n8n/reminders", post({ loanId: overdue, reminderDate: TODAY, outcome: "sent" }));
    expect(gone.status).toBe(404);
    const returned = await makeLoan(t, toolId, owner._id, borrower._id, { status: "returned" });
    const res = await t.fetch("/api/n8n/reminders", post({ loanId: returned, reminderDate: TODAY, outcome: "sent" }));
    expect(res.status).toBe(409);
  });
});

describe("POST /api/n8n/automation-events", () => {
  it("records a sanitized workflow error and fails the linked undelivered event", async () => {
    const { t, overdue } = await setup();
    const eventId = await t.run((ctx) =>
      ctx.db.insert("automationEvents", {
        loanId: overdue,
        type: "request_created",
        recipientRole: "borrower",
        status: "pending",
        attempts: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const delivered = await t.run((ctx) =>
      ctx.db.insert("automationEvents", {
        loanId: overdue,
        type: "request_approved",
        recipientRole: "borrower",
        status: "delivered",
        attempts: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const res = await t.fetch(
      "/api/n8n/automation-events",
      post({
        workflowName: "Workflow 1",
        executionId: "42",
        nodeName: "Send Email",
        message: `SMTP failed for borrower@example.com \n ${"x".repeat(500)}`,
        eventId,
      }),
    );
    expect(res.status).toBe(201);
    const second = await t.fetch(
      "/api/n8n/automation-events",
      post({ workflowName: "Workflow 1", executionId: "43", message: "late", eventId: delivered }),
    );
    expect(second.status).toBe(201);

    const state = await t.run(async (ctx) => ({
      errors: await ctx.db.query("workflowErrors").collect(),
      ev: await ctx.db.get("automationEvents", eventId),
      del: await ctx.db.get("automationEvents", delivered),
      all: await ctx.db.query("automationEvents").collect(),
    }));
    expect(state.errors).toHaveLength(2);
    expect(state.errors[0]).toMatchObject({
      workflowName: "Workflow 1",
      executionId: "42",
      nodeName: "Send Email",
      loanId: overdue,
    });
    expect(state.errors[0]?.message.length).toBeLessThanOrEqual(300);
    expect(state.errors[0]?.message).not.toContain("@");
    expect(state.errors[0]?.message).toContain("[email]");
    expect(state.ev).toMatchObject({ status: "failed", lastErrorCode: "WORKFLOW_ERROR" });
    expect(state.del?.status).toBe("delivered");
    const wfEvents = state.all.filter((e) => e.type === "workflow_error");
    expect(wfEvents).toHaveLength(1);
    expect(wfEvents[0]).toMatchObject({ loanId: overdue, status: "failed" });
  });

  it("400 on missing/invalid fields", async () => {
    const t = newT();
    for (const b of [
      {},
      { workflowName: "w", executionId: "1" },
      { workflowName: "", executionId: "1", message: "m" },
      { workflowName: "w", executionId: 1, message: "m" },
      { workflowName: "w", executionId: "1", message: "m", loanId: 5 },
    ]) {
      expect((await t.fetch("/api/n8n/automation-events", post(b))).status).toBe(400);
    }
    expect(await t.run((ctx) => ctx.db.query("workflowErrors").collect())).toHaveLength(0);
  });

  it("an unknown/invalid event or loan id does not break write-back", async () => {
    const t = newT();
    const res = await t.fetch(
      "/api/n8n/automation-events",
      post({ workflowName: "w", executionId: "1", message: "m", loanId: "nope", eventId: "nope" }),
    );
    expect(res.status).toBe(201);
    const rows = await t.run((ctx) => ctx.db.query("workflowErrors").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.loanId).toBeUndefined();
  });
});
