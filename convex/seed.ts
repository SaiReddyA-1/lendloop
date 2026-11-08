import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { addDays, todayUtc } from "./lib/dates";
import { clerkJwtIssuerDomain } from "./lib/env";
import { appError } from "./lib/errors";
import { enqueueLoanEvent } from "./lib/notify";
import { roleValidator, sanitizeText } from "./lib/validation";

// Operator-only demo data (internal: not reachable from clients). Usage:
//   npx convex run seed:run                      -> 3 placeholder users (cannot log in), demo tools/loans
//   npx convex run seed:run '{"clerkUsers":[{"clerkUserId":"user_...","name":"Alex","email":"a@example.com","role":"admin"}, ...]}'
//   npx convex run seed:run '{"force":true}'     -> seed even when tools already exist (adds more rows)
// `scripts/seed-clerk-users.mjs` creates Clerk TEST users and prints/runs the second form.

type Cat = Doc<"tools">["category"];
type Cond = Doc<"tools">["condition"];

const TOOLS: { name: string; category: Cat; condition: Cond; description: string }[] = [
  { name: "Cordless drill", category: "power_tools", condition: "good", description: "18V drill/driver with two batteries and a basic bit set. Charger included." },
  { name: "Circular saw", category: "power_tools", condition: "like_new", description: "7-1/4 inch corded saw. Blade is fresh; bring your own safety glasses." },
  { name: "Pressure washer", category: "cleaning", condition: "fair", description: "Electric 1800 PSI washer, 5 m hose. Great for patios and bikes." },
  { name: "Hedge trimmer", category: "garden", condition: "good", description: "Battery hedge trimmer, 55 cm blade. Battery lasts about 40 minutes." },
  { name: "4-person tent", category: "camping", condition: "good", description: "Three-season dome tent with footprint. Pegs and pole bag included." },
  { name: "Stand mixer", category: "kitchen", condition: "like_new", description: "5 L tilt-head mixer with whisk, paddle and dough hook." },
  { name: "Wheelbarrow", category: "garden", condition: "worn", description: "Sturdy steel wheelbarrow, 100 L. Tyre has a slow leak, pump included." },
  { name: "Tile cutter", category: "hand_tools", condition: "good", description: "Manual 600 mm tile cutter with spare scoring wheel." },
  { name: "Step ladder", category: "other", condition: "fair", description: "6-step aluminium ladder, 150 kg rating." },
  { name: "Carpet cleaner", category: "cleaning", condition: "good", description: "Upright carpet shampooer. Cleaning solution not included." },
];

const clerkUserValidator = v.object({
  clerkUserId: v.string(),
  name: v.string(),
  email: v.string(),
  role: roleValidator,
});

// Placeholder users: tokenIdentifier `seed|...` can never match a Clerk token, so nobody can sign in as them.
const PLACEHOLDERS = [
  { clerkUserId: "demo_alex", name: "Alex Rivera", email: "alex.rivera@example.com", role: "admin" as const },
  { clerkUserId: "demo_sam", name: "Sam Chen", email: "sam.chen@example.com", role: "user" as const },
  { clerkUserId: "demo_priya", name: "Priya Patel", email: "priya.patel@example.com", role: "user" as const },
];

export const run = internalMutation({
  args: { clerkUsers: v.optional(v.array(clerkUserValidator)), force: v.optional(v.boolean()) },
  returns: v.object({ users: v.number(), tools: v.number(), loans: v.number() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("tools").first();
    if (existing && !args.force) {
      throw appError("CONFLICT", 'Tools already exist; pass {"force":true} to seed anyway.');
    }

    // 1. Users. Real Clerk users map via tokenIdentifier; placeholders cannot sign in.
    const provided = args.clerkUsers;
    if (provided && (provided.length < 2 || provided.length > 10)) {
      throw appError("VALIDATION", "Provide between 2 and 10 clerkUsers (or none for placeholders).");
    }
    let issuer = "";
    if (provided) {
      issuer = clerkJwtIssuerDomain();
      if (!issuer) throw appError("VALIDATION", "CLERK_JWT_ISSUER_DOMAIN must be set to map Clerk users.");
    }
    const now = Date.now();
    const users: Doc<"users">[] = [];
    for (const spec of provided ?? PLACEHOLDERS) {
      const tokenIdentifier = provided ? `${issuer}|${spec.clerkUserId}` : `seed|${spec.clerkUserId}`;
      const found = await ctx.db
        .query("users")
        .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
        .unique();
      if (found) {
        users.push(found);
        continue;
      }
      const id = await ctx.db.insert("users", {
        tokenIdentifier,
        clerkUserId: spec.clerkUserId,
        name: sanitizeText(spec.name).slice(0, 80) || "Unknown",
        email: spec.email.trim().slice(0, 254),
        role: spec.role,
        trustedLender: false,
        createdAt: now,
        updatedAt: now,
      });
      const doc = await ctx.db.get("users", id);
      if (!doc) throw appError("CONFLICT", "Seed user insert failed.");
      users.push(doc);
    }
    const n = users.length;
    const user = (i: number): Doc<"users"> => {
      const u = users[i % n];
      if (!u) throw appError("CONFLICT", "No seed user.");
      return u;
    };

    // 2. Tools: owners rotate through the users.
    const tools: { id: Id<"tools">; ownerIdx: number }[] = [];
    for (const [i, t] of TOOLS.entries()) {
      const id = await ctx.db.insert("tools", {
        ownerId: user(i)._id,
        name: t.name,
        category: t.category,
        condition: t.condition,
        description: t.description,
        status: "active",
        createdAt: now + i,
        updatedAt: now + i,
      });
      tools.push({ id, ownerIdx: i % n });
    }

    // 3. One Trusted Lender (user #2: a non-admin in the default set), granted by the CLI (audited).
    const trusted = user(1);
    await ctx.db.patch("users", trusted._id, { trustedLender: true, updatedAt: now });
    await writeAudit(ctx, {
      actor: "system:cli",
      action: "user.trusted.grant",
      targetType: "user",
      targetId: trusted._id,
      reason: "Seed data",
    });

    // 4. Loans in every state. Rows are inserted DIRECTLY (not through loans.request) on purpose: the
    // overdue loan needs a past endDate, which request validation correctly rejects. Only the pending
    // request goes through the outbox, so n8n workflow 1 fires for a real event.
    const today = todayUtc();
    const mkLoan = async (
      toolIdx: number,
      status: Doc<"loans">["status"],
      startOffset: number,
      endOffset: number,
    ): Promise<Id<"loans">> => {
      const tool = tools[toolIdx];
      if (!tool) throw appError("CONFLICT", "Seed tool missing.");
      const t = Date.now();
      return ctx.db.insert("loans", {
        toolId: tool.id,
        ownerId: user(tool.ownerIdx)._id,
        borrowerId: user(tool.ownerIdx + 1)._id,
        startDate: addDays(today, startOffset),
        endDate: addDays(today, endOffset),
        status,
        ...(status === "approved" || status === "declined" || status === "returned" ? { decidedAt: t } : {}),
        ...(status === "returned" ? { returnedAt: t } : {}),
        createdAt: t,
        updatedAt: t,
      });
    };
    await mkLoan(3, "approved", -2, 3); // active
    await mkLoan(4, "approved", -12, -5); // OVERDUE (endDate in the past)
    await mkLoan(5, "declined", 4, 6);
    await mkLoan(6, "returned", -20, -15);
    await mkLoan(7, "cancelled", 10, 12);
    const pending = await mkLoan(0, "pending", 5, 8);
    await enqueueLoanEvent(ctx, { loanId: pending, type: "request_created", recipientRole: "owner" });

    return { users: n, tools: tools.length, loans: 6 };
  },
});
