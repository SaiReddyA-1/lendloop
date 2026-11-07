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

// "today" is pinned to 2026-11-08 (UTC).
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = newT();
  const a = await makeUser(t, "user_a"); // borrower
  const b = await makeUser(t, "user_b", { trustedLender: true }); // owner
  const c = await makeUser(t, "user_c"); // third party / second borrower
  const admin = await makeUser(t, "user_admin", { role: "admin" });
  const toolId = await makeTool(t, b._id);
  const as = (sub: string) => t.withIdentity(identity(sub, { email: `${sub}@example.com` }));
  const req = (sub: string, startDate: string, endDate: string, tool = toolId) =>
    as(sub).mutation(api.loans.request, { toolId: tool, startDate, endDate });
  return { t, a, b, c, admin, toolId, as, req };
}

describe("loans: unauthenticated access", () => {
  it("every public function throws UNAUTHENTICATED", async () => {
    const { t, a, b, toolId } = await setup();
    const loanId = await makeLoan(t, toolId, b._id, a._id);
    const calls: Array<() => Promise<unknown>> = [
      () => t.mutation(api.loans.request, { toolId, startDate: "2026-11-10", endDate: "2026-11-11" }),
      () => t.mutation(api.loans.approve, { loanId }),
      () => t.mutation(api.loans.decline, { loanId }),
      () => t.mutation(api.loans.cancel, { loanId }),
      () => t.mutation(api.loans.markReturned, { loanId }),
      () => t.query(api.loans.listMyRequests, {}),
      () => t.query(api.loans.listIncoming, {}),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    }
  });
});

describe("loans: authorization (BOLA / BFLA)", () => {
  it("third party cannot approve, decline or markReturned a loan on B's tool", async () => {
    const { t, a, b, toolId, as } = await setup();
    const loanId = await makeLoan(t, toolId, b._id, a._id);
    for (const fn of [api.loans.approve, api.loans.decline, api.loans.markReturned]) {
      await expect(as("user_c").mutation(fn, { loanId })).rejects.toMatchObject({
        data: { code: "NOT_FOUND" },
      });
    }
  });
  it("user A (not owner) cannot approve a loan on B's tool even when A is a different borrower", async () => {
    const { t, b, c, toolId, as } = await setup();
    const loanId = await makeLoan(t, toolId, b._id, c._id);
    await expect(as("user_a").mutation(api.loans.approve, { loanId })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
  });
  it("borrower cannot approve their own request", async () => {
    const { t, a, b, toolId, as } = await setup();
    const loanId = await makeLoan(t, toolId, b._id, a._id);
    await expect(as("user_a").mutation(api.loans.approve, { loanId })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
  });
  it("owner cannot cancel the borrower's request", async () => {
    const { t, a, b, toolId, as } = await setup();
    const loanId = await makeLoan(t, toolId, b._id, a._id);
    await expect(as("user_b").mutation(api.loans.cancel, { loanId })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
  });
  it("third party cannot cancel", async () => {
    const { t, a, b, toolId, as } = await setup();
    const loanId = await makeLoan(t, toolId, b._id, a._id);
    await expect(as("user_c").mutation(api.loans.cancel, { loanId })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
  });
  it("admin has no loan powers", async () => {
    const { t, a, b, toolId, as } = await setup();
    const loanId = await makeLoan(t, toolId, b._id, a._id);
    await expect(as("user_admin").mutation(api.loans.approve, { loanId })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
  });
});

describe("loans: state machine via functions", () => {
  async function loanIn(status: "declined" | "cancelled" | "returned" | "approved" | "pending") {
    const s = await setup();
    const loanId = await makeLoan(s.t, s.toolId, s.b._id, s.a._id, { status });
    return { ...s, loanId };
  }
  for (const status of ["declined", "cancelled", "returned"] as const) {
    it(`approving a ${status} request is INVALID_TRANSITION`, async () => {
      const { as, loanId } = await loanIn(status);
      await expect(as("user_b").mutation(api.loans.approve, { loanId })).rejects.toMatchObject({
        data: { code: "INVALID_TRANSITION" },
      });
    });
  }
  it("markReturned on a pending loan is INVALID_TRANSITION", async () => {
    const { as, loanId } = await loanIn("pending");
    await expect(as("user_b").mutation(api.loans.markReturned, { loanId })).rejects.toMatchObject({
      data: { code: "INVALID_TRANSITION" },
    });
  });
  it("returning twice is INVALID_TRANSITION", async () => {
    const { as, loanId } = await loanIn("approved");
    await as("user_b").mutation(api.loans.markReturned, { loanId });
    await expect(as("user_b").mutation(api.loans.markReturned, { loanId })).rejects.toMatchObject({
      data: { code: "INVALID_TRANSITION" },
    });
  });
  it("cancelling an approved loan is INVALID_TRANSITION", async () => {
    const { as, loanId } = await loanIn("approved");
    await expect(as("user_a").mutation(api.loans.cancel, { loanId })).rejects.toMatchObject({
      data: { code: "INVALID_TRANSITION" },
    });
  });
  it("declining an approved loan is INVALID_TRANSITION", async () => {
    const { as, loanId } = await loanIn("approved");
    await expect(as("user_b").mutation(api.loans.decline, { loanId })).rejects.toMatchObject({
      data: { code: "INVALID_TRANSITION" },
    });
  });
});

describe("loans.request validation", () => {
  const fail = (code: string) => ({ data: { code } });

  it("rejects start after end", async () => {
    const { req } = await setup();
    await expect(req("user_a", "2026-11-12", "2026-11-10")).rejects.toMatchObject(fail("VALIDATION"));
  });
  it("rejects invalid date strings", async () => {
    const { req } = await setup();
    for (const bad of ["tomorrow", "2026-02-30", "2026-11-1", ""]) {
      await expect(req("user_a", bad, "2026-11-12")).rejects.toMatchObject(fail("VALIDATION"));
    }
  });
  it("allows a start date of yesterday (time-zone tolerance)", async () => {
    const { req } = await setup();
    await expect(req("user_a", "2026-11-07", "2026-11-09")).resolves.toBeTruthy();
  });
  it("rejects a start date two days ago", async () => {
    const { req } = await setup();
    await expect(req("user_a", "2026-11-06", "2026-11-09")).rejects.toMatchObject(fail("VALIDATION"));
  });
  it("allows exactly 30 days and rejects 31", async () => {
    const { req } = await setup();
    await expect(req("user_a", "2026-11-10", "2026-12-09")).resolves.toBeTruthy();
    await expect(req("user_a", "2026-11-10", "2026-12-10")).rejects.toMatchObject(fail("VALIDATION"));
  });
  it("rejects borrowing your own tool", async () => {
    const { req } = await setup();
    await expect(req("user_b", "2026-11-10", "2026-11-11")).rejects.toMatchObject({
      data: { code: "VALIDATION", message: "You can't borrow your own tool." },
    });
  });
  it("rejects a removed tool as NOT_FOUND", async () => {
    const { t, req, toolId } = await setup();
    await t.run((ctx) => ctx.db.patch("tools", toolId, { status: "removed" }));
    await expect(req("user_a", "2026-11-10", "2026-11-11")).rejects.toMatchObject(fail("NOT_FOUND"));
  });
  it("rejects overlap with an approved loan, including touching edges", async () => {
    const { t, a, b, toolId, req } = await setup();
    await makeLoan(t, toolId, b._id, a._id, { status: "approved" }); // 10..12
    await expect(req("user_c", "2026-11-12", "2026-11-14")).rejects.toMatchObject(fail("CONFLICT")); // end == start
    await expect(req("user_c", "2026-11-08", "2026-11-10")).rejects.toMatchObject(fail("CONFLICT")); // end == start (other side)
    await expect(req("user_c", "2026-11-11", "2026-11-11")).rejects.toMatchObject(fail("CONFLICT")); // inside
    await expect(req("user_c", "2026-11-13", "2026-11-14")).resolves.toBeTruthy(); // adjacent day is free
  });
  it("ignores non-approved loans when checking availability", async () => {
    const { t, a, b, toolId, req } = await setup();
    await makeLoan(t, toolId, b._id, a._id, { status: "declined" });
    await makeLoan(t, toolId, b._id, a._id, { status: "returned" });
    await expect(req("user_c", "2026-11-10", "2026-11-12")).resolves.toBeTruthy();
  });
  it("rejects a duplicate overlapping pending request by the same borrower", async () => {
    const { req } = await setup();
    await req("user_a", "2026-11-10", "2026-11-12");
    await expect(req("user_a", "2026-11-12", "2026-11-13")).rejects.toMatchObject(fail("CONFLICT"));
  });
  it("allows overlapping pending requests from different borrowers", async () => {
    const { req } = await setup();
    await req("user_a", "2026-11-10", "2026-11-12");
    await expect(req("user_c", "2026-11-10", "2026-11-12")).resolves.toBeTruthy();
  });
  it("rate limit: at most 5 pending requests per borrower", async () => {
    const { t, req } = await setup();
    for (let i = 0; i < 5; i++) {
      const owner = await makeUser(t, `owner_${i}`);
      const tool = await makeTool(t, owner._id);
      await req("user_a", "2026-11-10", "2026-11-11", tool);
    }
    const owner = await makeUser(t, "owner_x");
    const tool = await makeTool(t, owner._id);
    await expect(req("user_a", "2026-11-10", "2026-11-11", tool)).rejects.toMatchObject(
      fail("RATE_LIMITED"),
    );
  });
  it("rate limit: at most 10 requests per hour, reset after the hour", async () => {
    const { as, toolId, req } = await setup();
    for (let i = 0; i < 10; i++) {
      const loanId = await req("user_a", "2026-11-10", "2026-11-11");
      await as("user_a").mutation(api.loans.cancel, { loanId });
    }
    await expect(req("user_a", "2026-11-10", "2026-11-11")).rejects.toMatchObject(
      fail("RATE_LIMITED"),
    );
    vi.setSystemTime(new Date("2026-11-08T13:00:01.000Z"));
    await expect(
      as("user_a").mutation(api.loans.request, {
        toolId,
        startDate: "2026-11-10",
        endDate: "2026-11-11",
      }),
    ).resolves.toBeTruthy();
  });
  it("stores owner from the tool and borrower from identity", async () => {
    const { t, a, b, req } = await setup();
    const id = await req("user_a", "2026-11-10", "2026-11-11");
    const loan = await t.run((ctx) => ctx.db.get("loans", id));
    expect(loan).toMatchObject({ ownerId: b._id, borrowerId: a._id, status: "pending" });
  });
});

describe("loans.approve", () => {
  it("auto-declines overlapping pending requests and enqueues events", async () => {
    const { t, req, as } = await setup();
    const first = await req("user_a", "2026-11-10", "2026-11-12");
    const second = await req("user_c", "2026-11-12", "2026-11-14"); // overlaps on 12th
    const disjoint = await req("user_c", "2026-11-20", "2026-11-21");
    await as("user_b").mutation(api.loans.approve, { loanId: first });
    const status = (id: typeof first) => t.run(async (ctx) => (await ctx.db.get("loans", id))?.status);
    expect(await status(first)).toBe("approved");
    expect(await status(second)).toBe("declined");
    expect(await status(disjoint)).toBe("pending");
    const ev = await events(t);
    expect(ev.filter((e) => e.loanId === second).map((e) => [e.type, e.recipientRole])).toEqual([
      ["request_created", "owner"],
      ["request_declined", "borrower"],
    ]);
    expect(ev.filter((e) => e.loanId === disjoint)).toHaveLength(1); // only request_created
  });
  it("cannot approve a request that now overlaps another approved loan", async () => {
    const { t, a, b, toolId, req, as } = await setup();
    const loanId = await req("user_c", "2026-11-10", "2026-11-12");
    await makeLoan(t, toolId, b._id, a._id, { status: "approved", startDate: "2026-11-12", endDate: "2026-11-13" });
    await expect(as("user_b").mutation(api.loans.approve, { loanId })).rejects.toMatchObject({
      data: { code: "CONFLICT" },
    });
  });
  it("rejects an expired request", async () => {
    const { req, as } = await setup();
    const loanId = await req("user_a", "2026-11-10", "2026-11-12");
    vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));
    await expect(as("user_b").mutation(api.loans.approve, { loanId })).rejects.toMatchObject({
      data: { code: "VALIDATION", message: "This request has expired." },
    });
  });
  it("cannot approve once the tool is removed", async () => {
    const { t, b, c, toolId, as } = await setup();
    const loanId = await makeLoan(t, toolId, b._id, c._id);
    await t.run((ctx) => ctx.db.patch("tools", toolId, { status: "removed" }));
    await expect(as("user_b").mutation(api.loans.approve, { loanId })).rejects.toMatchObject({
      data: { code: "CONFLICT" },
    });
  });
});

describe("automation events per transition", () => {
  it("emits the correct type + recipientRole for each transition", async () => {
    const { t, req, as } = await setup();
    const l1 = await req("user_a", "2026-11-10", "2026-11-11");
    await as("user_b").mutation(api.loans.approve, { loanId: l1 });
    await as("user_b").mutation(api.loans.markReturned, { loanId: l1 });
    const l2 = await req("user_a", "2026-11-15", "2026-11-16");
    await as("user_b").mutation(api.loans.decline, { loanId: l2 });
    const l3 = await req("user_c", "2026-11-18", "2026-11-19");
    await as("user_c").mutation(api.loans.cancel, { loanId: l3 });

    const ev = (await events(t)).map((e) => [e.loanId, e.type, e.recipientRole]);
    expect(ev).toEqual([
      [l1, "request_created", "owner"],
      [l1, "request_approved", "borrower"],
      [l1, "loan_returned", "borrower"],
      [l2, "request_created", "owner"],
      [l2, "request_declined", "borrower"],
      [l3, "request_created", "owner"],
      [l3, "request_cancelled", "owner"],
    ]);
  });
  it("rejected transitions enqueue nothing", async () => {
    const { t, b, a, toolId, as } = await setup();
    const loanId = await makeLoan(t, toolId, b._id, a._id, { status: "declined" });
    await as("user_b").mutation(api.loans.approve, { loanId }).catch(() => undefined);
    expect(await events(t)).toEqual([]);
  });
});

describe("loan listings", () => {
  it("listMyRequests returns only the caller's loans with derived status and no PII", async () => {
    const { t, a, b, c, toolId, as } = await setup();
    await makeLoan(t, toolId, b._id, a._id, { status: "approved", startDate: "2026-11-07", endDate: "2026-11-09" });
    await makeLoan(t, toolId, b._id, c._id);
    const res = await as("user_a").query(api.loans.listMyRequests, {});
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ toolName: "Cordless drill", ownerName: "Name user_b", status: "approved", displayStatus: "active" });
    expect(leaksSensitive(res)).toBe(false);
  });
  it("listMyRequests shows overdue for ended, unreturned approved loans", async () => {
    const { t, a, b, toolId, as } = await setup();
    await makeLoan(t, toolId, b._id, a._id, { status: "approved", startDate: "2026-11-01", endDate: "2026-11-05" });
    expect((await as("user_a").query(api.loans.listMyRequests, {}))[0]?.displayStatus).toBe("overdue");
  });
  it("listIncoming returns only loans on the caller's tools, without email or ids", async () => {
    const { t, a, b, c, toolId, as } = await setup();
    const otherTool = await makeTool(t, c._id);
    await makeLoan(t, toolId, b._id, a._id);
    await makeLoan(t, otherTool, c._id, a._id);
    const res = await as("user_b").query(api.loans.listIncoming, {});
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ borrowerName: "Name user_a", borrowerTrustedLender: false, displayStatus: "pending" });
    expect(leaksSensitive(res)).toBe(false);
    expect(await as("user_a").query(api.loans.listIncoming, {})).toEqual([]);
  });
  it("listIncoming includes loans of every status", async () => {
    const { t, a, b, toolId, as } = await setup();
    for (const status of ["pending", "approved", "declined", "cancelled", "returned"] as const) {
      await makeLoan(t, toolId, b._id, a._id, { status });
    }
    expect(await as("user_b").query(api.loans.listIncoming, {})).toHaveLength(5);
  });
});
