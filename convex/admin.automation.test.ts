import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { collectKeys, identity, makeLoan, makeTool, makeUser, newT, NOW_ISO } from "../tests/helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  vi.stubEnv("N8N_WEBHOOK_URL", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = newT();
  await makeUser(t, "user_admin", { role: "admin" });
  const owner = await makeUser(t, "user_owner");
  const borrower = await makeUser(t, "user_borrower");
  await t.run((ctx) => ctx.db.patch("users", borrower._id, { email: "borrower@example.com" }));
  const toolId = await makeTool(t, owner._id);
  const loanId = await makeLoan(t, toolId, owner._id, borrower._id);
  const failedId = await t.run((ctx) =>
    ctx.db.insert("automationEvents", {
      loanId,
      type: "request_approved",
      recipientRole: "borrower",
      status: "failed",
      attempts: 5,
      lastErrorCode: "HTTP_500",
      createdAt: 10,
      updatedAt: 20,
    }),
  );
  return {
    t,
    loanId,
    failedId,
    asAdmin: t.withIdentity(identity("user_admin")),
    asUser: t.withIdentity(identity("user_owner")),
  };
}

describe("admin automation re-drive", () => {
  it("non-admin gets FORBIDDEN and anonymous UNAUTHENTICATED; nothing changes", async () => {
    const { t, failedId, asUser } = await setup();
    await expect(asUser.mutation(api.admin.retryAutomationEvent, { eventId: failedId })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(asUser.query(api.admin.listFailedAutomationEvents, {})).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(t.mutation(api.admin.retryAutomationEvent, { eventId: failedId })).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
    await expect(t.query(api.admin.listFailedAutomationEvents, {})).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
    expect((await t.run((ctx) => ctx.db.get("automationEvents", failedId)))?.status).toBe("failed");
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(0);
  });

  it("lists failed events with a minimal projection (no emails or user ids)", async () => {
    const { t, asAdmin, failedId, loanId } = await setup();
    // A delivered event must not be listed.
    await t.run((ctx) =>
      ctx.db.insert("automationEvents", {
        loanId,
        type: "request_created",
        recipientRole: "owner",
        status: "delivered",
        attempts: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const rows = await asAdmin.query(api.admin.listFailedAutomationEvents, {});
    expect(rows).toEqual([
      {
        _id: failedId,
        type: "request_approved",
        lastErrorCode: "HTTP_500",
        attempts: 5,
        updatedAt: 20,
        toolName: "Cordless drill",
      },
    ]);
    const keys = collectKeys(rows);
    for (const k of ["email", "ownerId", "borrowerId", "loanId"]) expect(keys.has(k), k).toBe(false);
  });

  it("retry resets the event, schedules delivery and writes an audit row", async () => {
    const { t, asAdmin, failedId, loanId } = await setup();
    await asAdmin.mutation(api.admin.retryAutomationEvent, { eventId: failedId });
    const ev = await t.run((ctx) => ctx.db.get("automationEvents", failedId));
    expect(ev).toMatchObject({ status: "pending", attempts: 0 });
    expect(ev?.lastErrorCode).toBeUndefined();
    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "automation.retry",
      targetType: "loan",
      targetId: loanId,
      actorLabel: "user",
    });
    // The scheduled delivery runs (webhook unconfigured in this test, so it fails closed with NOT_CONFIGURED).
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get("automationEvents", failedId))).toMatchObject({
      status: "failed",
      lastErrorCode: "NOT_CONFIGURED",
    });
  });

  it("only failed events of retryable types can be retried (CONFLICT otherwise)", async () => {
    const { t, asAdmin, failedId, loanId } = await setup();
    await asAdmin.mutation(api.admin.retryAutomationEvent, { eventId: failedId });
    await expect(asAdmin.mutation(api.admin.retryAutomationEvent, { eventId: failedId })).rejects.toMatchObject({
      data: { code: "CONFLICT" },
    });
    const wfErr = await t.run((ctx) =>
      ctx.db.insert("automationEvents", {
        loanId,
        type: "workflow_error",
        recipientRole: "admin",
        status: "failed",
        attempts: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await expect(asAdmin.mutation(api.admin.retryAutomationEvent, { eventId: wfErr })).rejects.toMatchObject({
      data: { code: "CONFLICT" },
    });
  });
});
