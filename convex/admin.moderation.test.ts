import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { collectKeys, identity, makeLoan, makeTool, makeUser, newT, NOW_ISO } from "../tests/helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = newT();
  const admin = await makeUser(t, "user_admin", { role: "admin" });
  const owner = await makeUser(t, "user_owner");
  const borrower = await makeUser(t, "user_borrower");
  await t.run(async (ctx) => {
    await ctx.db.patch("users", owner._id, { email: "owner@example.com" });
    await ctx.db.patch("users", borrower._id, { email: "borrower@example.com" });
  });
  const toolId = await makeTool(t, owner._id);
  return {
    t,
    admin,
    owner,
    borrower,
    toolId,
    asAdmin: t.withIdentity(identity("user_admin")),
    asUser: t.withIdentity(identity("user_owner")),
    anon: t,
  };
}

describe("admin moderation: access control", () => {
  it("rejects non-admin (FORBIDDEN) and unauthenticated (UNAUTHENTICATED) on every function", async () => {
    const { asUser, anon, toolId, owner } = await setup();
    const calls: [string, (c: typeof asUser) => Promise<unknown>][] = [
      ["removeTool", (c) => c.mutation(api.admin.removeTool, { toolId, reason: "because" })],
      [
        "setTrustedLender",
        (c) => c.mutation(api.admin.setTrustedLender, { userId: owner._id, trusted: true }),
      ],
      ["listUsers", (c) => c.query(api.admin.listUsers, {})],
      ["listTools", (c) => c.query(api.admin.listTools, {})],
      ["listLoans", (c) => c.query(api.admin.listLoans, {})],
      ["listAuditLog", (c) => c.query(api.admin.listAuditLog, {})],
      ["listWorkflowErrors", (c) => c.query(api.admin.listWorkflowErrors, {})],
    ];
    for (const [name, call] of calls) {
      await expect(call(asUser), name).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
      await expect(call(anon as unknown as typeof asUser), name).rejects.toMatchObject({
        data: { code: "UNAUTHENTICATED" },
      });
    }
  });
});

describe("admin.removeTool", () => {
  it("cancels pending loans, keeps approved, audits with reason, blocks double removal", async () => {
    const { t, asAdmin, admin, owner, borrower, toolId } = await setup();
    const pending = await makeLoan(t, toolId, owner._id, borrower._id, { status: "pending" });
    const approved = await makeLoan(t, toolId, owner._id, borrower._id, {
      status: "approved",
      startDate: "2026-12-01",
      endDate: "2026-12-02",
    });
    const res = await asAdmin.mutation(api.admin.removeTool, {
      toolId,
      reason: "  Unsafe \n item  ",
    });
    expect(res).toEqual({ cancelledLoans: 1 });
    const state = await t.run(async (ctx) => ({
      tool: await ctx.db.get("tools", toolId),
      pending: await ctx.db.get("loans", pending),
      approved: await ctx.db.get("loans", approved),
      audit: await ctx.db.query("auditLog").collect(),
      events: await ctx.db.query("automationEvents").collect(),
    }));
    expect(state.tool).toMatchObject({ status: "removed", removedBy: admin._id });
    expect(state.pending?.status).toBe("cancelled");
    expect(state.approved?.status).toBe("approved");
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({
      action: "tool.remove",
      targetType: "tool",
      targetId: toolId,
      reason: "Unsafe item",
      actorId: admin._id,
    });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ type: "request_cancelled", recipientRole: "borrower" });

    await expect(
      asAdmin.mutation(api.admin.removeTool, { toolId, reason: "again" }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(1);
  });

  it("validates reason length (3-200) and tool existence", async () => {
    const { asAdmin, toolId } = await setup();
    for (const reason of ["ab", "  a ", "x".repeat(201)]) {
      await expect(asAdmin.mutation(api.admin.removeTool, { toolId, reason })).rejects.toMatchObject(
        { data: { code: "VALIDATION" } },
      );
    }
  });
});

describe("admin.setTrustedLender", () => {
  it("grants and revokes with audit; no-op when unchanged writes no audit", async () => {
    const { t, asAdmin, owner } = await setup();
    expect(
      await asAdmin.mutation(api.admin.setTrustedLender, {
        userId: owner._id,
        trusted: true,
        reason: "Great neighbor",
      }),
    ).toEqual({ changed: true });
    expect((await t.run((ctx) => ctx.db.get("users", owner._id)))?.trustedLender).toBe(true);
    expect(
      await asAdmin.mutation(api.admin.setTrustedLender, { userId: owner._id, trusted: true }),
    ).toEqual({ changed: false });
    expect(
      await asAdmin.mutation(api.admin.setTrustedLender, { userId: owner._id, trusted: false }),
    ).toEqual({ changed: true });
    const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log.map((l) => l.action)).toEqual(["user.trusted.grant", "user.trusted.revoke"]);
    expect(log[0]).toMatchObject({ targetId: owner._id, reason: "Great neighbor" });
  });

  it("an admin cannot change their own trusted status", async () => {
    const { t, asAdmin, admin } = await setup();
    await expect(
      asAdmin.mutation(api.admin.setTrustedLender, { userId: admin._id, trusted: true }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(0);
  });
});

describe("admin list projections", () => {
  it("contain no sensitive keys or emails and resolve labels server-side", async () => {
    const { t, asAdmin, admin, owner, borrower, toolId } = await setup();
    await makeLoan(t, toolId, owner._id, borrower._id, { status: "approved" });
    await asAdmin.mutation(api.admin.setTrustedLender, { userId: owner._id, trusted: true });
    await asAdmin.mutation(api.admin.removeTool, { toolId, reason: "policy" });
    await t.run((ctx) =>
      ctx.db.insert("workflowErrors", {
        workflowName: "wf",
        executionId: "1",
        message: "boom",
        createdAt: 5,
      }),
    );

    const users = await asAdmin.query(api.admin.listUsers, {});
    const tools = await asAdmin.query(api.admin.listTools, { includeRemoved: true });
    const loans = await asAdmin.query(api.admin.listLoans, { status: "approved" });
    const audit = await asAdmin.query(api.admin.listAuditLog, {});
    const errs = await asAdmin.query(api.admin.listWorkflowErrors, {});

    const forbidden = ["email", "tokenIdentifier", "clerkUserId", "ownerId", "borrowerId", "targetId"];
    for (const out of [users, tools, loans, audit, errs]) {
      const keys = collectKeys(out);
      for (const k of forbidden) expect(keys.has(k), k).toBe(false);
      expect(JSON.stringify(out)).not.toContain("@");
    }
    expect(users).toHaveLength(3);
    expect(users.find((u) => u._id === owner._id)).toMatchObject({
      trustedLender: true,
      activeToolCount: 0,
    });
    expect(users.find((u) => u._id === admin._id)?.role).toBe("admin");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ status: "removed", ownerName: owner.name });
    expect(await asAdmin.query(api.admin.listTools, {})).toHaveLength(0);
    expect(loans[0]).toMatchObject({
      toolName: "Cordless drill",
      ownerName: owner.name,
      borrowerName: borrower.name,
    });
    expect(audit.map((a) => a.action).sort()).toEqual(["tool.remove", "user.trusted.grant"]);
    const removal = audit.find((a) => a.action === "tool.remove");
    expect(removal).toMatchObject({
      targetLabel: "Cordless drill",
      actorName: admin.name,
      reason: "policy",
    });
    expect(audit.find((a) => a.action === "user.trusted.grant")?.targetLabel).toBe(owner.name);
    expect(errs).toHaveLength(1);
  });

  it("listAuditLog clamps the limit to 1..100", async () => {
    const { t, asAdmin } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 120; i++) {
        await ctx.db.insert("auditLog", {
          actorLabel: "system:cli",
          action: "user.role.promote",
          targetType: "user",
          targetId: "x",
          createdAt: i,
        });
      }
    });
    expect(await asAdmin.query(api.admin.listAuditLog, {})).toHaveLength(50);
    expect(await asAdmin.query(api.admin.listAuditLog, { limit: 0 })).toHaveLength(1);
    expect(await asAdmin.query(api.admin.listAuditLog, { limit: -5 })).toHaveLength(1);
    expect(await asAdmin.query(api.admin.listAuditLog, { limit: 9999 })).toHaveLength(100);
    const newest = await asAdmin.query(api.admin.listAuditLog, { limit: 1 });
    expect(newest[0]?.createdAt).toBe(119);
  });
});
