import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import {
  events,
  identity,
  leaksSensitive,
  makeLoan,
  makeTool,
  makeUser,
  newT,
  NOW_ISO,
} from "../tests/helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = newT();
  const a = await makeUser(t, "user_a");
  const b = await makeUser(t, "user_b", { trustedLender: true });
  const admin = await makeUser(t, "user_admin", { role: "admin" });
  return {
    t,
    a,
    b,
    admin,
    as: (sub: string) => t.withIdentity(identity(sub, { email: `${sub}@example.com` })),
  };
}
const valid = {
  name: "Hedge trimmer",
  category: "garden",
  condition: "good",
  description: "Electric",
} as const;

describe("tools: unauthenticated access", () => {
  it("every public function except listPublic throws UNAUTHENTICATED", async () => {
    const { t, b } = await setup();
    const toolId = await makeTool(t, b._id);
    const calls: Array<() => Promise<unknown>> = [
      () => t.query(api.tools.list, {}),
      () => t.query(api.tools.listMine, {}),
      () => t.query(api.tools.get, { toolId }),
      () => t.mutation(api.tools.create, valid),
      () => t.mutation(api.tools.update, { toolId, name: "Zzz" }),
      () => t.mutation(api.tools.remove, { toolId }),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    }
  });
});

describe("tools: BOLA / owner-only", () => {
  it("user A cannot update B's tool (NOT_FOUND)", async () => {
    const { t, b, as } = await setup();
    const toolId = await makeTool(t, b._id);
    await expect(
      as("user_a").mutation(api.tools.update, { toolId, name: "Hacked" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
  it("user A cannot remove B's tool (NOT_FOUND)", async () => {
    const { t, b, as } = await setup();
    const toolId = await makeTool(t, b._id);
    await expect(as("user_a").mutation(api.tools.remove, { toolId })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
  });
  it("admin cannot update a user's tool via tools.update", async () => {
    const { t, b, as } = await setup();
    const toolId = await makeTool(t, b._id);
    await expect(
      as("user_admin").mutation(api.tools.update, { toolId, name: "Admin edit" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
  it("owner can update own tool partially", async () => {
    const { t, b, as } = await setup();
    const toolId = await makeTool(t, b._id);
    await as("user_b").mutation(api.tools.update, { toolId, condition: "worn" });
    const doc = await t.run((ctx) => ctx.db.get("tools", toolId));
    expect(doc).toMatchObject({ condition: "worn", name: "Cordless drill" });
  });
  it("update with no fields is rejected", async () => {
    const { t, b, as } = await setup();
    const toolId = await makeTool(t, b._id);
    await expect(as("user_b").mutation(api.tools.update, { toolId })).rejects.toMatchObject({
      data: { code: "VALIDATION" },
    });
  });
  it("update on a removed tool is a CONFLICT", async () => {
    const { t, b, as } = await setup();
    const toolId = await makeTool(t, b._id);
    await as("user_b").mutation(api.tools.remove, { toolId });
    await expect(
      as("user_b").mutation(api.tools.update, { toolId, name: "Again" }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  });
});

describe("tools: input validation", () => {
  it("rejects a too-short name", async () => {
    const { as } = await setup();
    await expect(
      as("user_a").mutation(api.tools.create, { ...valid, name: "x" }),
    ).rejects.toMatchObject({ data: { code: "VALIDATION" } });
  });
  it("rejects a too-long name", async () => {
    const { as } = await setup();
    await expect(
      as("user_a").mutation(api.tools.create, { ...valid, name: "x".repeat(81) }),
    ).rejects.toMatchObject({ data: { code: "VALIDATION" } });
  });
  it("rejects a description over 500 chars", async () => {
    const { as } = await setup();
    await expect(
      as("user_a").mutation(api.tools.create, { ...valid, description: "d".repeat(501) }),
    ).rejects.toMatchObject({ data: { code: "VALIDATION" } });
  });
  it("accepts a 500-char description", async () => {
    const { as } = await setup();
    await expect(
      as("user_a").mutation(api.tools.create, { ...valid, description: "d".repeat(500) }),
    ).resolves.toBeTruthy();
  });
  it("rejects an invalid category at the validator layer", async () => {
    const { as } = await setup();
    await expect(
      // @ts-expect-error deliberately invalid category
      as("user_a").mutation(api.tools.create, { ...valid, category: "weapons" }),
    ).rejects.toThrow();
  });
  it("strips control characters from name and description", async () => {
    const { t, as } = await setup();
    const id = await as("user_a").mutation(api.tools.create, {
      ...valid,
      name: "Saw\u0000\u0007  blade\n",
      description: "line\u001b[31m one\u0000",
    });
    const doc = await t.run((ctx) => ctx.db.get("tools", id));
    expect(doc?.name).toBe("Saw blade");
    expect(doc?.description).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
  });
  it("caps active tools at 50 per user (RATE_LIMITED)", async () => {
    const { t, a, as } = await setup();
    for (let i = 0; i < 50; i++) await makeTool(t, a._id);
    await expect(as("user_a").mutation(api.tools.create, valid)).rejects.toMatchObject({
      data: { code: "RATE_LIMITED" },
    });
  });
  it("rate limit: at most 10 tool creations per hour (resets after the hour)", async () => {
    const { as } = await setup();
    for (let i = 0; i < 10; i++) await as("user_a").mutation(api.tools.create, valid);
    await expect(as("user_a").mutation(api.tools.create, valid)).rejects.toMatchObject({
      data: { code: "RATE_LIMITED" },
    });
    // Other users are unaffected.
    await expect(as("user_b").mutation(api.tools.create, valid)).resolves.toBeTruthy();
    vi.setSystemTime(new Date("2026-11-08T13:00:01.000Z"));
    await expect(as("user_a").mutation(api.tools.create, valid)).resolves.toBeTruthy();
  });
  it("owner is the caller, never client-supplied", async () => {
    const { t, a, as } = await setup();
    const id = await as("user_a").mutation(api.tools.create, valid);
    expect((await t.run((ctx) => ctx.db.get("tools", id)))?.ownerId).toBe(a._id);
  });
});

describe("tools.remove", () => {
  it("is blocked by an approved loan", async () => {
    const { t, a, b, as } = await setup();
    const toolId = await makeTool(t, b._id);
    const loanId = await makeLoan(t, toolId, b._id, a._id);
    await as("user_b").mutation(api.loans.approve, { loanId });
    await expect(as("user_b").mutation(api.tools.remove, { toolId })).rejects.toMatchObject({
      data: { code: "CONFLICT", message: "Mark the current loan as returned first." },
    });
  });
  it("works after the loan is returned", async () => {
    const { t, a, b, as } = await setup();
    const toolId = await makeTool(t, b._id);
    const loanId = await makeLoan(t, toolId, b._id, a._id);
    await as("user_b").mutation(api.loans.approve, { loanId });
    await as("user_b").mutation(api.loans.markReturned, { loanId });
    await expect(as("user_b").mutation(api.tools.remove, { toolId })).resolves.toBeNull();
  });
  it("cancels pending loans and enqueues request_cancelled for each borrower", async () => {
    const { t, a, b, as } = await setup();
    const c = await makeUser(t, "user_c");
    const toolId = await makeTool(t, b._id);
    const l1 = await makeLoan(t, toolId, b._id, a._id);
    const l2 = await makeLoan(t, toolId, b._id, c._id);
    await as("user_b").mutation(api.tools.remove, { toolId });
    const loans = await t.run(async (ctx) => [
      await ctx.db.get("loans", l1),
      await ctx.db.get("loans", l2),
    ]);
    expect(loans.map((l) => l?.status)).toEqual(["cancelled", "cancelled"]);
    const ev = await events(t);
    expect(ev).toHaveLength(2);
    expect(ev.every((e) => e.type === "request_cancelled" && e.recipientRole === "borrower")).toBe(
      true,
    );
    expect(ev.map((e) => e.loanId).sort()).toEqual([l1, l2].sort());
    const tool = await t.run((ctx) => ctx.db.get("tools", toolId));
    expect(tool).toMatchObject({ status: "removed", removedBy: b._id });
  });
  it("removed tool disappears from listPublic and list, and is flagged in listMine", async () => {
    const { t, b, as } = await setup();
    const toolId = await makeTool(t, b._id);
    await as("user_b").mutation(api.tools.remove, { toolId });
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
    expect(await as("user_a").query(api.tools.list, {})).toEqual([]);
    const mine = await as("user_b").query(api.tools.listMine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: "removed", removedByAdmin: false });
    await expect(as("user_a").query(api.tools.get, { toolId })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
  });
  it("listMine lists all active tools first even when many removed tools exist", async () => {
    const { t, a, as } = await setup();
    // 260 removed tools created AFTER the active ones would previously crowd them out of a single take().
    const activeId = await makeTool(t, a._id);
    await t.run(async (ctx) => {
      for (let i = 0; i < 260; i++) {
        await ctx.db.insert("tools", {
          ownerId: a._id,
          name: `Gone ${i}`,
          category: "other",
          condition: "good",
          description: "",
          status: "removed",
          createdAt: 2 + i,
          updatedAt: 2 + i,
        });
      }
    });
    const mine = await as("user_a").query(api.tools.listMine, {});
    expect(mine[0]?._id).toBe(activeId);
    expect(mine[0]?.status).toBe("active");
    expect(mine.filter((m) => m.status === "removed")).toHaveLength(50);
  });
  it("flags admin-removed tools in listMine", async () => {
    const { t, b, admin, as } = await setup();
    const toolId = await makeTool(t, b._id);
    await t.run((ctx) =>
      ctx.db.patch("tools", toolId, { status: "removed", removedBy: admin._id, removedAt: 5 }),
    );
    expect((await as("user_b").query(api.tools.listMine, {}))[0]?.removedByAdmin).toBe(true);
  });
});

describe("tools queries", () => {
  it("listPublic returns exactly {category,name} per item, works unauthenticated, hides removed", async () => {
    const { t, a, b } = await setup();
    await makeTool(t, a._id);
    await makeTool(t, b._id);
    await t.run((ctx) =>
      ctx.db.insert("tools", {
        ownerId: a._id,
        name: "Gone",
        category: "other",
        condition: "good",
        description: "",
        status: "removed",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const res = await t.query(api.tools.listPublic, {});
    expect(res).toHaveLength(2);
    for (const item of res) expect(Object.keys(item).sort()).toEqual(["category", "name"]);
    expect(res.some((r) => r.name === "Gone")).toBe(false);
  });
  it("list never leaks email / identity fields and marks isMine", async () => {
    const { t, a, b, as } = await setup();
    await t.run((ctx) => ctx.db.patch("users", b._id, { email: "b@example.com" }));
    await makeTool(t, a._id);
    await makeTool(t, b._id);
    const res = await as("user_a").query(api.tools.list, {});
    expect(res).toHaveLength(2);
    expect(leaksSensitive(res)).toBe(false);
    expect(res.filter((r) => r.isMine)).toHaveLength(1);
    expect(res.find((r) => !r.isMine)).toMatchObject({
      ownerName: "Name user_b",
      ownerTrustedLender: true,
    });
  });
  it("list filters by category", async () => {
    const { t, a, as } = await setup();
    await makeTool(t, a._id); // power_tools
    await as("user_a").mutation(api.tools.create, valid); // garden
    const res = await as("user_b").query(api.tools.list, { category: "garden" });
    expect(res.map((r) => r.category)).toEqual(["garden"]);
  });
  it("list marks on_loan only when an approved loan covers today", async () => {
    const { t, a, b, as } = await setup();
    const toolId = await makeTool(t, b._id);
    const loanId = await makeLoan(t, toolId, b._id, a._id); // 2026-11-10..12
    await as("user_b").mutation(api.loans.approve, { loanId });
    expect((await as("user_a").query(api.tools.list, {}))[0]?.availability).toBe("available");
    await t.run((ctx) =>
      ctx.db.patch("loans", loanId, { startDate: "2026-11-07", endDate: "2026-11-09" }),
    );
    expect((await as("user_a").query(api.tools.list, {}))[0]?.availability).toBe("on_loan");
  });
  it("listMine returns only own tools with pending counts", async () => {
    const { t, a, b, as } = await setup();
    const mine = await makeTool(t, b._id);
    await makeTool(t, a._id);
    await makeLoan(t, mine, b._id, a._id);
    const res = await as("user_b").query(api.tools.listMine, {});
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ _id: mine, pendingRequests: 1 });
  });
  it("get returns booked ranges (no borrower info), excluding ended loans", async () => {
    const { t, a, b, as } = await setup();
    const toolId = await makeTool(t, b._id);
    const l1 = await makeLoan(t, toolId, b._id, a._id);
    await as("user_b").mutation(api.loans.approve, { loanId: l1 });
    await makeLoan(t, toolId, b._id, a._id, {
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      status: "approved",
    });
    const res = await as("user_a").query(api.tools.get, { toolId });
    expect(res.bookedRanges).toEqual([{ startDate: "2026-11-10", endDate: "2026-11-12" }]);
    expect(leaksSensitive(res)).toBe(false);
    expect(JSON.stringify(res)).not.toContain("borrower");
  });
});
