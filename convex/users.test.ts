import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { identity, makeUser, newT, tokenFor } from "../tests/helpers";

afterEach(() => vi.unstubAllEnvs());

const audits = (t: ReturnType<typeof newT>) => t.run((ctx) => ctx.db.query("auditLog").collect());

describe("users.ensureCurrent", () => {
  it("creates a plain user from identity claims only", async () => {
    const t = newT();
    const res = await t
      .withIdentity(identity("user_a", { name: "  Ada   Lovelace ", email: "ada@example.com" }))
      .mutation(api.users.ensureCurrent, {});
    expect(res).toEqual({ role: "user", name: "Ada Lovelace" });
    const rows = await t.run((ctx) => ctx.db.query("users").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tokenIdentifier: tokenFor("user_a"),
      clerkUserId: "user_a",
      role: "user",
      trustedLender: false,
      email: "ada@example.com",
    });
    expect(await audits(t)).toHaveLength(0);
  });

  it("never derives the display name from the email; falls back name -> givenName(+initial) -> Neighbor", async () => {
    const t = newT();
    const iss = "https://test.clerk.dev";
    const a = await t
      .withIdentity({ subject: "u1", issuer: iss, email: "bob@example.com" })
      .mutation(api.users.ensureCurrent, {});
    expect(a.name).toBe("Neighbor");
    const b = await t
      .withIdentity({ subject: "u2", issuer: iss, givenName: "Grace", familyName: "hopper" })
      .mutation(api.users.ensureCurrent, {});
    expect(b.name).toBe("Grace H.");
    const c = await t
      .withIdentity({ subject: "u3", issuer: iss, givenName: "Linus" })
      .mutation(api.users.ensureCurrent, {});
    expect(c.name).toBe("Linus");
    // A name claim that is itself an email address is not used.
    const d = await t
      .withIdentity({ subject: "u4", issuer: iss, name: "eve@example.com", givenName: "Eve" })
      .mutation(api.users.ensureCurrent, {});
    expect(d.name).toBe("Eve");
    const rows = await t.run((ctx) => ctx.db.query("users").collect());
    expect(rows.find((r) => r.clerkUserId === "u1")?.email).toBe("bob@example.com");
  });

  it("is idempotent: no duplicate rows", async () => {
    const t = newT();
    const as = t.withIdentity(identity("user_a"));
    await as.mutation(api.users.ensureCurrent, {});
    await as.mutation(api.users.ensureCurrent, {});
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
  });

  it("refreshes a changed name", async () => {
    const t = newT();
    await t.withIdentity(identity("user_a", { name: "Old" })).mutation(api.users.ensureCurrent, {});
    await t.withIdentity(identity("user_a", { name: "New" })).mutation(api.users.ensureCurrent, {});
    const rows = await t.run((ctx) => ctx.db.query("users").collect());
    expect(rows[0]?.name).toBe("New");
  });

  it("makes an allowlisted subject admin at signup and audits it", async () => {
    vi.stubEnv("ADMIN_CLERK_USER_IDS", " user_x , ,user_boss ");
    const t = newT();
    const res = await t.withIdentity(identity("user_boss")).mutation(api.users.ensureCurrent, {});
    expect(res.role).toBe("admin");
    const log = await audits(t);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      action: "user.role.promote",
      actorLabel: "system:bootstrap",
      targetType: "user",
    });
    expect(log[0]?.actorId).toBeUndefined();
  });

  it("promotes an existing user once when later allowlisted (idempotent audit)", async () => {
    const t = newT();
    const as = t.withIdentity(identity("user_late"));
    expect((await as.mutation(api.users.ensureCurrent, {})).role).toBe("user");
    vi.stubEnv("ADMIN_CLERK_USER_IDS", "user_late");
    expect((await as.mutation(api.users.ensureCurrent, {})).role).toBe("admin");
    expect((await as.mutation(api.users.ensureCurrent, {})).role).toBe("admin");
    expect(await audits(t)).toHaveLength(1);
  });

  it("does NOT demote when removed from the allowlist", async () => {
    vi.stubEnv("ADMIN_CLERK_USER_IDS", "user_boss");
    const t = newT();
    const as = t.withIdentity(identity("user_boss"));
    await as.mutation(api.users.ensureCurrent, {});
    vi.stubEnv("ADMIN_CLERK_USER_IDS", "");
    const res = await as.mutation(api.users.ensureCurrent, {});
    expect(res.role).toBe("admin");
    const rows = await t.run((ctx) => ctx.db.query("users").collect());
    expect(rows[0]?.role).toBe("admin");
    expect(await audits(t)).toHaveLength(1);
  });

  it("does not treat an email-like or partial id as allowlisted", async () => {
    vi.stubEnv("ADMIN_CLERK_USER_IDS", "user_boss");
    const t = newT();
    const res = await t.withIdentity(identity("user_bos")).mutation(api.users.ensureCurrent, {});
    expect(res.role).toBe("user");
  });

  it("rejects unauthenticated calls with UNAUTHENTICATED", async () => {
    const t = newT();
    await expect(t.mutation(api.users.ensureCurrent, {})).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
  });

  it("rejects extra client args such as role (validator)", async () => {
    const t = newT();
    const as = t.withIdentity(identity("user_a"));
    await expect(
      as.mutation(api.users.ensureCurrent, { role: "admin" } as never),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(0);
  });
});

describe("users.me", () => {
  it("returns null when unauthenticated", async () => {
    const t = newT();
    expect(await t.query(api.users.me, {})).toBeNull();
  });

  it("returns null for an unprovisioned identity", async () => {
    const t = newT();
    expect(await t.withIdentity(identity("ghost")).query(api.users.me, {})).toBeNull();
  });

  it("returns exactly the own projection and never other fields", async () => {
    const t = newT();
    await makeUser(t, "user_a", { role: "admin", trustedLender: true });
    await makeUser(t, "user_b");
    const me = await t.withIdentity(identity("user_a")).query(api.users.me, {});
    expect(me).not.toBeNull();
    // `email` is optional (absent for this row), so assert the exact key set without it.
    expect(Object.keys(me ?? {}).sort()).toEqual(["_id", "name", "role", "trustedLender"]);
    expect(me).toMatchObject({ name: "Name user_a", role: "admin", trustedLender: true });
    expect(me).not.toHaveProperty("tokenIdentifier");
    expect(me).not.toHaveProperty("clerkUserId");
  });
});
