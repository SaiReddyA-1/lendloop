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
): Promise<Id<"loans">> {
  return t.run((ctx) =>
    ctx.db.insert("loans", {
      toolId,
      ownerId,
      borrowerId,
      startDate: "2026-11-10",
      endDate: "2026-11-12",
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}
