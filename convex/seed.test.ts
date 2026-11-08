import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { newT } from "../tests/helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("seed:run", () => {
  it("creates placeholder users, tools, loans in every state, an audit row and one outbox event", async () => {
    const t = newT();
    const res = await t.mutation(internal.seed.run, {});
    expect(res).toEqual({ users: 3, tools: 10, loans: 6 });
    const data = await t.run(async (ctx) => ({
      users: await ctx.db.query("users").collect(),
      loans: await ctx.db.query("loans").collect(),
      events: await ctx.db.query("automationEvents").collect(),
      audit: await ctx.db.query("auditLog").collect(),
    }));
    expect(data.users.every((u) => u.tokenIdentifier.startsWith("seed|"))).toBe(true);
    expect(data.users.filter((u) => u.trustedLender)).toHaveLength(1);
    expect(data.users.filter((u) => u.role === "admin")).toHaveLength(1);
    expect(new Set(data.loans.map((l) => l.status))).toEqual(
      new Set(["pending", "approved", "declined", "cancelled", "returned"]),
    );
    const today = new Date().toISOString().slice(0, 10);
    expect(data.loans.filter((l) => l.status === "approved" && l.endDate < today)).toHaveLength(1);
    expect(data.events).toHaveLength(1);
    expect(data.events[0]).toMatchObject({ type: "request_created", recipientRole: "owner" });
    expect(data.audit).toHaveLength(1);
    expect(data.audit[0]).toMatchObject({ actorLabel: "system:cli", action: "user.trusted.grant" });
    for (const l of data.loans) expect(l.ownerId).not.toBe(l.borrowerId);
  });

  it("refuses a second run unless force is set", async () => {
    const t = newT();
    await t.mutation(internal.seed.run, {});
    await expect(t.mutation(internal.seed.run, {})).rejects.toThrow(/CONFLICT/);
    const res = await t.mutation(internal.seed.run, { force: true });
    expect(res.tools).toBe(10);
    const tools = await t.run((ctx) => ctx.db.query("tools").collect());
    expect(tools).toHaveLength(20);
    // placeholder users are reused, not duplicated
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(3);
  });

  it("maps real Clerk users via tokenIdentifier", async () => {
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://example.clerk.accounts.dev");
    const t = newT();
    await t.mutation(internal.seed.run, {
      clerkUsers: [
        { clerkUserId: "user_a", name: "A", email: "a@example.com", role: "admin" },
        { clerkUserId: "user_b", name: "B", email: "b@example.com", role: "user" },
      ],
    });
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users.map((u) => u.tokenIdentifier).sort()).toEqual([
      "https://example.clerk.accounts.dev|user_a",
      "https://example.clerk.accounts.dev|user_b",
    ]);
  });

  it("rejects clerkUsers without an issuer configured", async () => {
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "");
    const t = newT();
    await expect(
      t.mutation(internal.seed.run, {
        clerkUsers: [
          { clerkUserId: "user_a", name: "A", email: "a@example.com", role: "admin" },
          { clerkUserId: "user_b", name: "B", email: "b@example.com", role: "user" },
        ],
      }),
    ).rejects.toThrow(/VALIDATION/);
  });

  it("is internal-only (no public builders exported)", async () => {
    // convex-test resolves functions by name regardless of visibility, so check the source instead.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./seed.ts", import.meta.url), "utf8");
    expect(src).toMatch(/export const run = internalMutation\(/);
    expect(src).not.toMatch(/export const \w+ = (query|mutation|action)\(/);
  });
});
