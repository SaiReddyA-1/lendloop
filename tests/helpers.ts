// Test-only helpers. Deliberately OUTSIDE convex/ so they are never bundled
// or deployed as Convex functions.
import { convexTest } from "convex-test";
import type { Doc, Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { modules } from "../convex/test.setup";

export const ISSUER = "https://test.clerk.dev";

export function newT() {
  return convexTest(schema, modules);
}
export type T = ReturnType<typeof newT>;

export const tokenFor = (sub: string) => `${ISSUER}|${sub}`;

export function identity(sub: string, extra: { name?: string; email?: string } = {}) {
  return { subject: sub, issuer: ISSUER, name: extra.name ?? `Name ${sub}`, email: extra.email };
}

/** Inserts a users row matching `identity(sub)` and returns it. */
export async function makeUser(
  t: T,
  sub: string,
  opts: { role?: "admin" | "user"; trustedLender?: boolean } = {},
): Promise<Doc<"users">> {
  const id = await t.run((ctx) =>
    ctx.db.insert("users", {
      tokenIdentifier: tokenFor(sub),
      clerkUserId: sub,
      name: `Name ${sub}`,
      role: opts.role ?? "user",
      trustedLender: opts.trustedLender ?? false,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const doc = await t.run((ctx) => ctx.db.get(id));
  if (!doc) throw new Error("makeUser failed");
  return doc;
}

export function makeTool(t: T, ownerId: Id<"users">): Promise<Id<"tools">> {
  return t.run((ctx) =>
    ctx.db.insert("tools", {
      ownerId,
      name: "Cordless drill",
      category: "power_tools",
      condition: "good",
      description: "18V drill",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

export function makeLoan(
  t: T,
  toolId: Id<"tools">,
  ownerId: Id<"users">,
  borrowerId: Id<"users">,
  opts: { startDate?: string; endDate?: string; status?: Doc<"loans">["status"] } = {},
): Promise<Id<"loans">> {
  return t.run((ctx) =>
    ctx.db.insert("loans", {
      toolId,
      ownerId,
      borrowerId,
      startDate: opts.startDate ?? "2026-11-10",
      endDate: opts.endDate ?? "2026-11-12",
      status: opts.status ?? "pending",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

/** "Now" pinned by tests that use fake timers. */
export const TODAY = "2026-11-08";
export const NOW_ISO = "2026-11-08T12:00:00.000Z";

/** Recursively collects every object key in a JSON-like value. */
export function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((x) => collectKeys(x, out));
  else if (value && typeof value === "object") {
    for (const [k, val] of Object.entries(value)) {
      out.add(k);
      collectKeys(val, out);
    }
  }
  return out;
}

/** True if a response leaks identity/PII keys anywhere, or any email-looking value. */
export function leaksSensitive(value: unknown): boolean {
  const bad = ["email", "tokenIdentifier", "clerkUserId", "ownerId", "borrowerId", "role"];
  const keys = collectKeys(value);
  return bad.some((k) => keys.has(k)) || JSON.stringify(value).includes("@");
}

/** All automationEvents (type + recipientRole + loanId) in insertion order. */
export function events(t: T) {
  return t.run(async (ctx) =>
    (await ctx.db.query("automationEvents").collect()).map((e) => ({
      loanId: e.loanId,
      type: e.type,
      recipientRole: e.recipientRole,
      status: e.status,
      attempts: e.attempts,
    })),
  );
}
