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

const CATEGORIES = ["power_tools", "hand_tools", "garden", "kitchen", "camping", "cleaning", "other"];

async function snapshot(t: ReturnType<typeof newT>) {
  return t.run(async (ctx) => ({
    users: await ctx.db.query("users").collect(),
    tools: await ctx.db.query("tools").collect(),
    loans: await ctx.db.query("loans").collect(),
    events: await ctx.db.query("automationEvents").collect(),
    reminders: await ctx.db.query("reminders").collect(),
    errors: await ctx.db.query("workflowErrors").collect(),
    audit: await ctx.db.query("auditLog").collect(),
  }));
}

describe("seed:run", () => {
  it("creates a lively dataset: users, unique tools in every category, loans in every state, history", async () => {
    const t = newT();
    const res = await t.mutation(internal.seed.run, {});
    expect(res).toEqual({ users: 8, tools: 27, loans: 17 });
    const data = await snapshot(t);
    expect(data.users).toHaveLength(8);
    expect(data.users.every((u) => u.tokenIdentifier.startsWith("seed|"))).toBe(true);
    expect(data.users.every((u) => u.email?.endsWith("@example.com"))).toBe(true);
    expect(data.users.filter((u) => u.trustedLender)).toHaveLength(2);
    expect(data.users.filter((u) => u.role === "admin")).toHaveLength(1);

    const names = data.tools.map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
    const active = data.tools.filter((x) => x.status === "active");
    expect(active).toHaveLength(26);
    expect(new Set(active.map((x) => x.category))).toEqual(new Set(CATEGORIES));
    expect(data.tools.filter((x) => x.status === "removed")).toHaveLength(1);
    expect(new Set(data.tools.map((x) => x.ownerId)).size).toBeGreaterThanOrEqual(6);
    for (const x of data.tools) {
      expect(x.name.length).toBeLessThanOrEqual(80);
      expect(x.description.length).toBeLessThanOrEqual(500);
    }

    expect(new Set(data.loans.map((l) => l.status))).toEqual(
      new Set(["pending", "approved", "declined", "cancelled", "returned"]),
    );
    const today = new Date().toISOString().slice(0, 10);
    const count = (s: string) => data.loans.filter((l) => l.status === s).length;
    expect(count("pending")).toBe(4);
    expect(count("declined")).toBe(2);
    expect(count("cancelled")).toBe(1);
    expect(count("returned")).toBe(3);
    const approved = data.loans.filter((l) => l.status === "approved");
    expect(approved.filter((l) => l.startDate > today)).toHaveLength(3);
    expect(approved.filter((l) => l.startDate <= today && l.endDate >= today)).toHaveLength(2);
    expect(approved.filter((l) => l.endDate < today)).toHaveLength(2);

    for (const l of data.loans) expect(l.ownerId).not.toBe(l.borrowerId);
    // no overlapping approved loans per tool
    for (const a of approved) {
      for (const b of approved) {
        if (a._id !== b._id && a.toolId === b.toolId) {
          expect(a.endDate < b.startDate || b.endDate < a.startDate).toBe(true);
        }
      }
    }

    expect(data.events.filter((e) => e.status === "failed")).toHaveLength(1);
    expect(data.events.find((e) => e.status === "failed")).toMatchObject({ lastErrorCode: "HTTP_503", attempts: 5 });
    expect(data.events.filter((e) => e.status === "pending")).toHaveLength(0);
    expect(data.events.every((e) => e.createdAt < Date.now())).toBe(true);
    expect(data.reminders).toHaveLength(1);
    expect(data.errors).toHaveLength(1);
    expect(data.audit.filter((a) => a.action === "user.trusted.grant")).toHaveLength(2);
    expect(data.audit.filter((a) => a.action === "tool.remove")).toHaveLength(1);
  });

  it("does not schedule deliveries by default", async () => {
    const t = newT();
    await t.mutation(internal.seed.run, {});
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(0);
  });

  it("enqueues one real delivery per pending loan when notify is true", async () => {
    const t = newT();
    await t.mutation(internal.seed.run, { notify: true });
    const data = await snapshot(t);
    expect(data.events.filter((e) => e.status === "pending")).toHaveLength(4);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(4);
  });

  it("refuses a second run unless force is set", async () => {
    const t = newT();
    await t.mutation(internal.seed.run, {});
    await expect(t.mutation(internal.seed.run, {})).rejects.toThrow(/CONFLICT/);
    const res = await t.mutation(internal.seed.run, { force: true });
    expect(res.tools).toBe(27);
    expect(await t.run((ctx) => ctx.db.query("tools").collect())).toHaveLength(54);
    // placeholder users are reused, not duplicated
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(8);
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
    const data = await snapshot(t);
    expect(data.users.map((u) => u.tokenIdentifier).sort()).toEqual([
      "https://example.clerk.accounts.dev|user_a",
      "https://example.clerk.accounts.dev|user_b",
    ]);
    for (const l of data.loans) expect(l.ownerId).not.toBe(l.borrowerId);
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
});

describe("seed:reset", () => {
  it("refuses unless ALLOW_SEED_RESET is true", async () => {
    vi.stubEnv("ALLOW_SEED_RESET", "");
    const t = newT();
    await t.mutation(internal.seed.run, {});
    await expect(
      t.mutation(internal.seed.reset, { confirm: "DELETE ALL DEV DATA" }),
    ).rejects.toThrow(/FORBIDDEN/);
    expect(await t.run((ctx) => ctx.db.query("tools").collect())).not.toHaveLength(0);
  });

  it("rejects a wrong confirmation phrase", async () => {
    vi.stubEnv("ALLOW_SEED_RESET", "true");
    const t = newT();
    await expect(
      // @ts-expect-error wrong literal on purpose
      t.mutation(internal.seed.reset, { confirm: "yes" }),
    ).rejects.toThrow();
  });

  it("clears every table and allows reseeding without force", async () => {
    vi.stubEnv("ALLOW_SEED_RESET", "true");
    const t = newT();
    await t.mutation(internal.seed.run, {});
    const res = await t.mutation(internal.seed.reset, { confirm: "DELETE ALL DEV DATA" });
    expect(res.done).toBe(true);
    const data = await snapshot(t);
    for (const rows of Object.values(data)) expect(rows).toHaveLength(0);
    await t.mutation(internal.seed.run, {});
    expect(await t.run((ctx) => ctx.db.query("tools").collect())).toHaveLength(27);
  });
});

describe("seed module", () => {
  it("is internal-only (no public builders exported)", async () => {
    // convex-test resolves functions by name regardless of visibility, so check the source instead.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./seed.ts", import.meta.url), "utf8");
    expect(src).toMatch(/export const run = internalMutation\(/);
    expect(src).toMatch(/export const reset = internalMutation\(/);
    expect(src).not.toMatch(/export const \w+ = (query|mutation|action)\(/);
  });
});
