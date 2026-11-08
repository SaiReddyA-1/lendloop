import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { declineOverlappingPending } from "./lib/autoDecline";
import { cancelPendingForTool } from "./lib/toolRemoval";
import { STUCK_AFTER_MS } from "./maintenance";
import { events, makeLoan, makeTool, makeUser, newT, NOW_ISO } from "../tests/helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  vi.stubEnv("N8N_WEBHOOK_URL", ""); // deliveries fail closed (NOT_CONFIGURED) without network
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = newT();
  const owner = await makeUser(t, "user_owner");
  const borrower = await makeUser(t, "user_borrower");
  await t.run((ctx) => ctx.db.patch("users", borrower._id, { email: "b@example.com" }));
  const toolId = await makeTool(t, owner._id);
  const loanId = await makeLoan(t, toolId, owner._id, borrower._id);
  return { t, owner, borrower, toolId, loanId };
}

describe("sweepStuckEvents", () => {
  it("re-drives old pending events with no future retry; leaves fresh, scheduled and non-pending alone", async () => {
    const { t, loanId } = await setup();
    const now = Date.now();
    const base = {
      loanId,
      type: "request_created" as const,
      recipientRole: "owner" as const,
      attempts: 0,
      createdAt: 1,
    };
    const ids = await t.run(async (ctx) => ({
      stuck: await ctx.db.insert("automationEvents", { ...base, status: "pending", updatedAt: now - STUCK_AFTER_MS - 1 }),
      stuckPastRetry: await ctx.db.insert("automationEvents", {
        ...base,
        status: "pending",
        updatedAt: now - STUCK_AFTER_MS - 1,
        nextAttemptAt: now - 1000,
      }),
      fresh: await ctx.db.insert("automationEvents", { ...base, status: "pending", updatedAt: now - 1000 }),
      futureRetry: await ctx.db.insert("automationEvents", {
        ...base,
        status: "pending",
        updatedAt: now - STUCK_AFTER_MS - 1,
        nextAttemptAt: now + 60_000,
      }),
      failed: await ctx.db.insert("automationEvents", { ...base, status: "failed", updatedAt: now - STUCK_AFTER_MS - 1 }),
    }));
    const res = await t.mutation(internal.maintenance.sweepStuckEvents, {});
    expect(res).toEqual({ rescheduled: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const status = async (id: (typeof ids)[keyof typeof ids]) =>
      (await t.run((ctx) => ctx.db.get("automationEvents", id)))?.status;
    // Re-driven events were delivered (failed NOT_CONFIGURED here); untouched ones stay pending.
    expect(await status(ids.stuck)).toBe("failed");
    expect(await status(ids.stuckPastRetry)).toBe("failed");
    expect(await status(ids.fresh)).toBe("pending");
    expect(await status(ids.futureRetry)).toBe("pending");
    // Sweeping again does nothing: updatedAt was refreshed / rows are no longer pending.
    expect(await t.mutation(internal.maintenance.sweepStuckEvents, {})).toEqual({ rescheduled: 0 });
  });

  it("is bounded to 100 rows per run", async () => {
    const { t, loanId } = await setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 105; i++) {
        await ctx.db.insert("automationEvents", {
          loanId,
          type: "request_created",
          recipientRole: "owner",
          status: "pending",
          attempts: 0,
          createdAt: 1,
          updatedAt: now - STUCK_AFTER_MS - 1 - i,
        });
      }
    });
    expect(await t.mutation(internal.maintenance.sweepStuckEvents, {})).toEqual({ rescheduled: 100 });
  });
});

describe("bulk batching (L8)", () => {
  it("cancelPendingForTool processes in bounded batches and reports hasMore", async () => {
    const { t, owner, borrower, toolId, loanId } = await setup();
    for (let i = 0; i < 4; i++) await makeLoan(t, toolId, owner._id, borrower._id); // 5 pending in total
    const run = (limit: number) => t.run((ctx) => cancelPendingForTool(ctx, toolId, limit));
    expect(await run(2)).toEqual({ cancelled: 2, hasMore: true });
    expect(await run(2)).toEqual({ cancelled: 2, hasMore: true });
    expect(await run(2)).toEqual({ cancelled: 1, hasMore: false });
    expect((await t.run((ctx) => ctx.db.get("loans", loanId)))?.status).toBe("cancelled");
    expect((await events(t)).filter((e) => e.type === "request_cancelled")).toHaveLength(5);
  });

  it("continueToolRemoval only acts on removed tools", async () => {
    const { t, toolId, loanId } = await setup();
    await t.mutation(internal.maintenance.continueToolRemoval, { toolId }); // tool still active: no-op
    expect((await t.run((ctx) => ctx.db.get("loans", loanId)))?.status).toBe("pending");
    await t.run((ctx) => ctx.db.patch("tools", toolId, { status: "removed" }));
    await t.mutation(internal.maintenance.continueToolRemoval, { toolId });
    expect((await t.run((ctx) => ctx.db.get("loans", loanId)))?.status).toBe("cancelled");
  });

  it("declineOverlappingPending pages with a creation-time cursor and skips non-overlapping rows", async () => {
    const { t, owner, borrower, toolId } = await setup();
    const approvedId = await makeLoan(t, toolId, owner._id, borrower._id, {
      status: "approved",
      startDate: "2026-11-10",
      endDate: "2026-11-12",
    });
    // The setup loan (2026-11-10..12) overlaps; add 3 more overlapping and 2 non-overlapping rows.
    for (let i = 0; i < 3; i++) await makeLoan(t, toolId, owner._id, borrower._id);
    for (let i = 0; i < 2; i++) {
      await makeLoan(t, toolId, owner._id, borrower._id, { startDate: "2026-12-01", endDate: "2026-12-02" });
    }
    const approved = await t.run((ctx) => ctx.db.get("loans", approvedId));
    if (!approved) throw new Error("missing");
    let after = 0;
    let declined = 0;
    let rounds = 0;
    for (;;) {
      const cursor = after;
      const r = await t.run((ctx) => declineOverlappingPending(ctx, approved, cursor, 2));
      declined += r.declined;
      rounds++;
      if (r.nextAfter === null) break;
      after = r.nextAfter;
    }
    expect(declined).toBe(4);
    expect(rounds).toBeGreaterThan(1);
    const rows = await t.run((ctx) => ctx.db.query("loans").collect());
    expect(rows.filter((l) => l.status === "pending")).toHaveLength(2); // the non-overlapping ones remain
    expect(rows.filter((l) => l.status === "declined")).toHaveLength(4);
  });
});
