import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import * as admin from "./admin";
import { makeUser, newT } from "../tests/helpers";

describe("admin internal mutations", () => {
  it("are internal functions, not part of the public api", () => {
    // Runtime: Convex marks registered functions as public or internal.
    for (const fn of [admin.promoteToAdmin, admin.demoteToUser]) {
      const flags = fn as unknown as { isInternal?: boolean; isPublic?: boolean };
      expect(flags.isInternal).toBe(true);
      expect(flags.isPublic).toBeUndefined();
    }
    // Type-level: `api` (public) must not contain them; `internal` must.
    // @ts-expect-error promoteToAdmin is internal-only
    void api.admin.promoteToAdmin;
    void internal.admin.promoteToAdmin;
  });

  it("promoteToAdmin promotes and audits as system:cli; second call is a no-op", async () => {
    const t = newT();
    const u = await makeUser(t, "user_a");
    const r1 = await t.mutation(internal.admin.promoteToAdmin, {
      clerkUserId: "user_a",
      reason: "  bootstrap \n owner ",
    });
    expect(r1).toEqual({ changed: true });
    const r2 = await t.mutation(internal.admin.promoteToAdmin, { clerkUserId: "user_a" });
    expect(r2).toEqual({ changed: false });
    const row = await t.run((ctx) => ctx.db.get("users", u._id));
    expect(row?.role).toBe("admin");
    const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actorLabel: "system:cli",
      action: "user.role.promote",
      targetType: "user",
      targetId: u._id,
      reason: "bootstrap owner",
    });
  });

  it("demoteToUser demotes and audits", async () => {
    const t = newT();
    const u = await makeUser(t, "user_a", { role: "admin" });
    await t.mutation(internal.admin.demoteToUser, { clerkUserId: "user_a" });
    expect((await t.run((ctx) => ctx.db.get("users", u._id)))?.role).toBe("user");
    const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log[0]).toMatchObject({ action: "user.role.demote", actorLabel: "system:cli" });
  });

  it("unknown clerk id -> NOT_FOUND", async () => {
    const t = newT();
    await expect(
      t.mutation(internal.admin.promoteToAdmin, { clerkUserId: "nobody" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
});
