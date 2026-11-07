import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { identity, makeLoan, makeTool, makeUser, newT, NOW_ISO } from "../tests/helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = newT();
  const owner = await makeUser(t, "user_owner");
  const borrower = await makeUser(t, "user_borrower");
  const stranger = await makeUser(t, "user_stranger");
  const admin = await makeUser(t, "user_admin", { role: "admin" });
  const toolId = await makeTool(t, owner._id);
  const mine = await makeLoan(t, toolId, owner._id, borrower._id);
  const other = await makeUser(t, "user_other");
  const foreign = await makeLoan(t, await makeTool(t, other._id), other._id, stranger._id);
  const addEvents = (loanId: Id<"loans">, n: number) =>
    t.run(async (ctx) => {
      for (let i = 0; i < n; i++) {
        await ctx.db.insert("automationEvents", {
          loanId,
          type: "request_created",
          recipientRole: "owner",
          status: "delivered",
          attempts: 1,
          lastErrorCode: "SECRET_CODE",
          createdAt: 100 + i,
          updatedAt: 100 + i,
        });
      }
    });
  return { t, owner, borrower, stranger, admin, mine, foreign, addEvents };
}

describe("automation.listForLoans", () => {
  it("requires sign-in", async () => {
    const { t, mine } = await setup();
    await expect(t.query(api.automation.listForLoans, { loanIds: [mine] })).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
  });

  it("returns latest 5 newest-first for parties only; foreign loans are silently omitted", async () => {
    const { t, mine, foreign, addEvents } = await setup();
    await addEvents(mine, 7);
    await addEvents(foreign, 2);
    for (const sub of ["user_owner", "user_borrower"]) {
      const out = await t
        .withIdentity(identity(sub))
        .query(api.automation.listForLoans, { loanIds: [mine, foreign] });
      expect(Object.keys(out)).toEqual([mine]);
      const list = out[mine] ?? [];
      expect(list).toHaveLength(5);
      expect(list.map((e) => e.createdAt)).toEqual([106, 105, 104, 103, 102]);
      expect(Object.keys(list[0] ?? {}).sort()).toEqual(
        ["attempts", "createdAt", "status", "type", "updatedAt"].sort(),
      );
      expect(JSON.stringify(out)).not.toContain("SECRET_CODE");
    }
    const none = await t
      .withIdentity(identity("user_stranger"))
      .query(api.automation.listForLoans, { loanIds: [mine] });
    expect(none).toEqual({});
  });

  it("admin can see any loan", async () => {
    const { t, mine, foreign, addEvents } = await setup();
    await addEvents(mine, 1);
    await addEvents(foreign, 1);
    const out = await t
      .withIdentity(identity("user_admin"))
      .query(api.automation.listForLoans, { loanIds: [mine, foreign] });
    expect(Object.keys(out).sort()).toEqual([mine, foreign].sort());
  });

  it("caps the id list at 100 (VALIDATION)", async () => {
    const { t, mine } = await setup();
    const as = t.withIdentity(identity("user_owner"));
    await expect(
      as.query(api.automation.listForLoans, { loanIds: Array(101).fill(mine) }),
    ).rejects.toMatchObject({ data: { code: "VALIDATION" } });
    await expect(
      as.query(api.automation.listForLoans, { loanIds: Array(100).fill(mine) }),
    ).resolves.toBeDefined();
  });
});
