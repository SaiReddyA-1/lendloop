import { afterEach, describe, expect, it, vi } from "vitest";
import { identity, makeLoan, makeTool, makeUser, newT } from "../../tests/helpers";
import {
  getIdentityOrThrow,
  isAdminAllowlisted,
  requireAdmin,
  requireLoanParty,
  requireToolOwner,
  requireUser,
} from "./auth";

afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = newT();
  const a = await makeUser(t, "user_a");
  const b = await makeUser(t, "user_b");
  const c = await makeUser(t, "user_c");
  const admin = await makeUser(t, "user_admin", { role: "admin" });
  const toolB = await makeTool(t, b._id);
  const loan = await makeLoan(t, toolB, b._id, a._id); // owner b, borrower a
  return { t, a, b, c, admin, toolB, loan };
}

describe("identity / user guards", () => {
  it("getIdentityOrThrow: UNAUTHENTICATED without identity", async () => {
    const t = newT();
    await expect(t.run((ctx) => getIdentityOrThrow(ctx))).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
  });

  it("requireUser: USER_NOT_PROVISIONED for a valid identity without a row", async () => {
    const t = newT();
    await expect(
      t.withIdentity(identity("ghost")).run((ctx) => requireUser(ctx)),
    ).rejects.toMatchObject({ data: { code: "USER_NOT_PROVISIONED" } });
  });

  it("requireUser: returns the caller's own row", async () => {
    const { t, a } = await setup();
    const u = await t.withIdentity(identity("user_a")).run((ctx) => requireUser(ctx));
    expect(u._id).toBe(a._id);
  });

  it("requireAdmin: non-admin gets FORBIDDEN, admin passes", async () => {
    const { t } = await setup();
    await expect(
      t.withIdentity(identity("user_a")).run((ctx) => requireAdmin(ctx)),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    const u = await t.withIdentity(identity("user_admin")).run((ctx) => requireAdmin(ctx));
    expect(u.role).toBe("admin");
  });
});

describe("requireToolOwner", () => {
  it("owner passes", async () => {
    const { t, b, toolB } = await setup();
    const r = await t.withIdentity(identity("user_b")).run((ctx) => requireToolOwner(ctx, toolB));
    expect(r.user._id).toBe(b._id);
    expect(r.tool._id).toBe(toolB);
  });

  it("non-owner gets NOT_FOUND (same as missing tool)", async () => {
    const { t, toolB } = await setup();
    const err = await t
      .withIdentity(identity("user_a"))
      .run((ctx) => requireToolOwner(ctx, toolB))
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ data: { code: "NOT_FOUND" } });

    // Indistinguishable from a genuinely missing tool.
    const deleted = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tools", {
        ownerId: (await ctx.db.query("users").first())!._id,
        name: "Temp",
        category: "other",
        condition: "good",
        description: "",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.delete("tools", id);
      return id;
    });
    const err2 = await t
      .withIdentity(identity("user_a"))
      .run((ctx) => requireToolOwner(ctx, deleted))
      .catch((e: unknown) => e);
    expect((err2 as { data: unknown }).data).toEqual((err as { data: unknown }).data);
  });

  it("admin is denied by default but passes with allowAdmin", async () => {
    const { t, toolB } = await setup();
    await expect(
      t.withIdentity(identity("user_admin")).run((ctx) => requireToolOwner(ctx, toolB)),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    const r = await t
      .withIdentity(identity("user_admin"))
      .run((ctx) => requireToolOwner(ctx, toolB, { allowAdmin: true }));
    expect(r.tool._id).toBe(toolB);
  });

  it("allowAdmin does not help a non-admin", async () => {
    const { t, toolB } = await setup();
    await expect(
      t.withIdentity(identity("user_a")).run((ctx) => requireToolOwner(ctx, toolB, { allowAdmin: true })),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });

  it("unauthenticated and unprovisioned callers are rejected before lookup", async () => {
    const { t, toolB } = await setup();
    await expect(t.run((ctx) => requireToolOwner(ctx, toolB))).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
    await expect(
      t.withIdentity(identity("ghost")).run((ctx) => requireToolOwner(ctx, toolB)),
    ).rejects.toMatchObject({ data: { code: "USER_NOT_PROVISIONED" } });
  });
});

describe("requireLoanParty matrix (owner=b, borrower=a, third=c)", () => {
  const cases: Array<[string, "owner" | "borrower" | "either", string, boolean]> = [
    ["owner as owner", "owner", "user_b", true],
    ["borrower as owner", "owner", "user_a", false],
    ["third as owner", "owner", "user_c", false],
    ["borrower as borrower", "borrower", "user_a", true],
    ["owner as borrower", "borrower", "user_b", false],
    ["third as borrower", "borrower", "user_c", false],
    ["owner as either", "either", "user_b", true],
    ["borrower as either", "either", "user_a", true],
    ["third as either", "either", "user_c", false],
  ];
  for (const [label, party, sub, ok] of cases) {
    it(`${label} -> ${ok ? "allowed" : "NOT_FOUND"}`, async () => {
      const { t, loan } = await setup();
      const p = t.withIdentity(identity(sub)).run((ctx) => requireLoanParty(ctx, loan, party));
      if (ok) await expect(p).resolves.toMatchObject({ loan: { _id: loan } });
      else await expect(p).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    });
  }

  it("admin only with allowAdmin", async () => {
    const { t, loan } = await setup();
    await expect(
      t.withIdentity(identity("user_admin")).run((ctx) => requireLoanParty(ctx, loan, "either")),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(
      t
        .withIdentity(identity("user_admin"))
        .run((ctx) => requireLoanParty(ctx, loan, "either", { allowAdmin: true })),
    ).resolves.toMatchObject({ loan: { _id: loan } });
  });
});

describe("isAdminAllowlisted", () => {
  it("parses comma-separated ids, trimming and ignoring empties", () => {
    vi.stubEnv("ADMIN_CLERK_USER_IDS", " user_1 ,, user_2,");
    expect(isAdminAllowlisted("user_1")).toBe(true);
    expect(isAdminAllowlisted("user_2")).toBe(true);
    expect(isAdminAllowlisted("user_3")).toBe(false);
    expect(isAdminAllowlisted("")).toBe(false);
  });
  it("is false when unset or empty", () => {
    vi.stubEnv("ADMIN_CLERK_USER_IDS", "");
    expect(isAdminAllowlisted("user_1")).toBe(false);
  });
});
