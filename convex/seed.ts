import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { addDays, todayUtc } from "./lib/dates";
import { allowSeedReset, clerkJwtIssuerDomain } from "./lib/env";
import { appError } from "./lib/errors";
import { enqueueLoanEvent } from "./lib/notify";
import { roleValidator, sanitizeText } from "./lib/validation";

// Operator-only demo data (internal: not reachable from clients). Usage:
//   npx convex env set ALLOW_SEED_RESET true      (DEV deployments only, never production)
//   npx convex run seed:reset '{"confirm":"DELETE ALL DEV DATA"}'   (repeat while it prints done:false)
//   npx convex run seed:run '{}'                  -> 8 placeholder users (cannot log in), 26 tools, 17 loans, history
//   npx convex run seed:run '{"notify":true}'     -> also enqueue real deliveries for the pending requests (n8n emails)
//   npx convex run seed:run '{"clerkUsers":[{"clerkUserId":"user_...","name":"Alex","email":"a@example.com","role":"admin"}, ...]}'
// Prefer reset then run over `{"force":true}` (force adds a second copy of every tool).
// `scripts/seed-clerk-users.mjs` creates Clerk TEST users and prints/runs the clerkUsers form.

type Cat = Doc<"tools">["category"];
type Cond = Doc<"tools">["condition"];

const DAY = 86_400_000;
const RESET_BATCH = 2000;

type SeedTool = { name: string; category: Cat; condition: Cond; description: string; removed?: boolean };

const TOOLS: SeedTool[] = [
  { name: "Cordless drill 18V", category: "power_tools", condition: "good", description: "Two batteries and a charger. Great for shelves and flat-pack furniture." },
  { name: "Circular saw", category: "power_tools", condition: "like_new", description: "Corded saw with a fresh blade and a rip fence. Bring your own safety glasses." },
  { name: "Laser level", category: "power_tools", condition: "like_new", description: "Self-leveling cross-line laser with a wall mount. Handy for hanging picture rows." },
  { name: "Orbital sander", category: "power_tools", condition: "fair", description: "Palm sander with a dust bag and ten sheets of 120 grit paper." },
  { name: "Tile cutter 60 cm", category: "hand_tools", condition: "good", description: "Manual cutter with a spare scoring wheel. Cuts straight lines up to 60 cm." },
  { name: "Socket set (metric)", category: "hand_tools", condition: "good", description: "Ratchet with sockets from 8 to 24 mm and two extension bars, in a carry case." },
  { name: "Stud finder", category: "hand_tools", condition: "like_new", description: "Detects wood studs and live wires. Takes a 9V battery, already installed." },
  { name: "Step ladder 2 m", category: "hand_tools", condition: "fair", description: "Six-step aluminium ladder with a wide platform. Folds flat for the car." },
  { name: "Hedge trimmer (electric)", category: "garden", condition: "good", description: "Corded trimmer with a 55 cm blade. A 10 m extension cable comes with it." },
  { name: "Leaf blower", category: "garden", condition: "good", description: "Battery blower, about 30 minutes per charge. Fine for gravel paths and gutters." },
  { name: "Wheelbarrow", category: "garden", condition: "worn", description: "Steel 100 L barrow. The tyre loses air slowly, a pump is tucked underneath." },
  { name: "Pruning saw", category: "garden", condition: "like_new", description: "Curved folding saw with a 25 cm blade. Cuts branches up to 10 cm thick." },
  { name: "Pasta machine", category: "kitchen", condition: "good", description: "Hand-crank roller and cutter for spaghetti and tagliatelle. Clamps to the table." },
  { name: "Stand mixer", category: "kitchen", condition: "like_new", description: "5 L tilt-head mixer with whisk, paddle and dough hook. Perfect for bread days." },
  { name: "Dehydrator", category: "kitchen", condition: "good", description: "Five trays with an adjustable thermostat. Makes apple chips and herbs in an evening." },
  { name: "Ice cream maker", category: "kitchen", condition: "fair", description: "Freeze the bowl for 24 hours first. Makes about 1.5 L per batch." },
  { name: "Two-person tent", category: "camping", condition: "good", description: "Lightweight three-season tent with a footprint. Pegs and pole bag included." },
  { name: "Camping stove with spare gas", category: "camping", condition: "good", description: "Single-burner stove, one full and one half-full gas canister, and a small pot." },
  { name: "Sleeping bags (x2)", category: "camping", condition: "fair", description: "Two three-season bags rated to 5 degrees C. Aired and washed after every trip." },
  { name: "Inflatable kayak", category: "camping", condition: "like_new", description: "Two-seater with paddles, pump and life vests. Fits in a car boot when packed." },
  { name: "Pressure washer 130 bar", category: "cleaning", condition: "fair", description: "Electric washer with a 5 m hose and a patio cleaner attachment." },
  { name: "Carpet cleaner", category: "cleaning", condition: "good", description: "Upright shampooer with two tanks. Cleaning solution is not included." },
  { name: "Window vacuum", category: "cleaning", condition: "like_new", description: "Cordless streak-free window cleaner with a spare microfibre pad." },
  { name: "Folding tables (x2)", category: "other", condition: "good", description: "Two 180 cm trestle tables. Ideal for street parties and garage sales." },
  { name: "Projector and screen", category: "other", condition: "good", description: "HD projector with a tripod screen and an HDMI cable. Great for movie nights." },
  { name: "Kids bike trailer", category: "other", condition: "fair", description: "Two-child trailer with a rain cover and a flag. Hitch fits most adult bikes." },
  { name: "Soldering station", category: "other", condition: "worn", description: "Old but reliable. Removed after the iron failed a safety check.", removed: true },
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
  { clerkUserId: "demo_maria", name: "Maria Alvarez", email: "maria.alvarez@example.com", role: "user" as const },
  { clerkUserId: "demo_jonas", name: "Jonas Weber", email: "jonas.weber@example.com", role: "user" as const },
  { clerkUserId: "demo_aisha", name: "Aisha Okafor", email: "aisha.okafor@example.com", role: "user" as const },
  { clerkUserId: "demo_tom", name: "Tom Becker", email: "tom.becker@example.com", role: "user" as const },
  { clerkUserId: "demo_lena", name: "Lena Kowalski", email: "lena.kowalski@example.com", role: "user" as const },
];

type LoanStatus = Doc<"loans">["status"];
// start/end are day offsets from today (UTC).
const LOANS: { tool: string; status: LoanStatus; start: number; end: number }[] = [
  // pending (future)
  { tool: "Laser level", status: "pending", start: 3, end: 5 },
  { tool: "Pasta machine", status: "pending", start: 6, end: 8 },
  { tool: "Projector and screen", status: "pending", start: 9, end: 11 },
  { tool: "Inflatable kayak", status: "pending", start: 14, end: 17 },
  // approved, upcoming
  { tool: "Tile cutter 60 cm", status: "approved", start: 2, end: 4 },
  { tool: "Folding tables (x2)", status: "approved", start: 7, end: 8 },
  { tool: "Two-person tent", status: "approved", start: 12, end: 14 },
  // approved, active today
  { tool: "Cordless drill 18V", status: "approved", start: -2, end: 2 },
  { tool: "Wheelbarrow", status: "approved", start: -1, end: 1 },
  // approved, overdue (not returned)
  { tool: "Pressure washer 130 bar", status: "approved", start: -9, end: -3 },
  { tool: "Carpet cleaner", status: "approved", start: -8, end: -2 },
  // returned
  { tool: "Stand mixer", status: "returned", start: -20, end: -15 },
  { tool: "Hedge trimmer (electric)", status: "returned", start: -14, end: -10 },
  { tool: "Step ladder 2 m", status: "returned", start: -30, end: -27 },
  // declined
  { tool: "Circular saw", status: "declined", start: 4, end: 6 },
  { tool: "Dehydrator", status: "declined", start: 3, end: 5 },
  // cancelled
  { tool: "Sleeping bags (x2)", status: "cancelled", start: 10, end: 12 },
];

// The upcoming approval whose notification "failed" (shows in the admin Failed notifications panel).
const FAILED_EVENT_TOOL = "Folding tables (x2)";
// The overdue loan that already got a reminder yesterday.
const REMINDED_TOOL = "Pressure washer 130 bar";

const RESET_TABLES = [
  "reminders",
  "automationEvents",
  "workflowErrors",
  "auditLog",
  "loans",
  "tools",
  "users",
] as const;

// Dev-only wipe of every app table, in bounded batches. Internal-only and env-guarded.
export const reset = internalMutation({
  args: { confirm: v.literal("DELETE ALL DEV DATA") },
  returns: v.object({ done: v.boolean(), deleted: v.number() }),
  handler: async (ctx) => {
    if (!allowSeedReset()) {
      throw appError("FORBIDDEN", "seed:reset is disabled. Set ALLOW_SEED_RESET=true on a DEV deployment first.");
    }
    let remaining = RESET_BATCH;
    for (const table of RESET_TABLES) {
      const rows = await ctx.db.query(table).take(remaining);
      for (const row of rows) await ctx.db.delete(table, row._id);
      remaining -= rows.length;
      if (remaining <= 0) return { done: false, deleted: RESET_BATCH };
    }
    return { done: true, deleted: RESET_BATCH - remaining };
  },
});

export const run = internalMutation({
  args: {
    clerkUsers: v.optional(v.array(clerkUserValidator)),
    force: v.optional(v.boolean()),
    notify: v.optional(v.boolean()),
  },
  returns: v.object({ users: v.number(), tools: v.number(), loans: v.number() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("tools").first();
    if (existing && !args.force) {
      throw appError(
        "CONFLICT",
        'Tools already exist. Run seed:reset then seed:run (preferred), or pass {"force":true} to add a second copy.',
      );
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
    for (const [i, spec] of (provided ?? PLACEHOLDERS).entries()) {
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
        createdAt: now - (60 - i) * DAY,
        updatedAt: now - (60 - i) * DAY,
      });
      const doc = await ctx.db.get("users", id);
      if (!doc) throw appError("CONFLICT", "Seed user insert failed.");
      users.push(doc);
    }
    const n = users.length;
    const user = (i: number): Doc<"users"> => {
      const u = users[((i % n) + n) % n];
      if (!u) throw appError("CONFLICT", "No seed user.");
      return u;
    };

    // 2. Tools: owners rotate through the users; creation times spread over the last weeks.
    const toolByName = new Map<string, { id: Id<"tools">; ownerIdx: number }>();
    let adminRemoval: { id: Id<"tools"> } | undefined;
    for (const [i, t] of TOOLS.entries()) {
      const createdAt = now - (50 - i) * DAY;
      const ownerIdx = i % n;
      const id = await ctx.db.insert("tools", {
        ownerId: user(ownerIdx)._id,
        name: t.name,
        category: t.category,
        condition: t.condition,
        description: t.description,
        status: t.removed ? "removed" : "active",
        ...(t.removed ? { removedAt: now - 3 * DAY, removedBy: user(0)._id } : {}),
        createdAt,
        updatedAt: createdAt,
      });
      toolByName.set(t.name, { id, ownerIdx });
      if (t.removed) adminRemoval = { id };
    }

    // 3. Trusted Lenders (users #2 and #4 in the default set, #2 only for tiny sets), granted by the CLI (audited).
    const trustedIdx = n > 4 ? [1, 3] : [1];
    for (const idx of trustedIdx) {
      const trusted = user(idx);
      await ctx.db.patch("users", trusted._id, { trustedLender: true, updatedAt: now });
      await writeAudit(ctx, {
        actor: "system:cli",
        action: "user.trusted.grant",
        targetType: "user",
        targetId: trusted._id,
        reason: "Seed data",
      });
    }
    if (adminRemoval) {
      await writeAudit(ctx, {
        actor: user(0),
        action: "tool.remove",
        targetType: "tool",
        targetId: adminRemoval.id,
        reason: "Failed a safety check",
      });
    }

    // 4. Loans in every state. Rows are inserted DIRECTLY (not through loans.request) because overdue and
    // past loans need dates that request validation correctly rejects. History is inserted as already
    // delivered automationEvents; only `notify: true` enqueues real deliveries (for pending requests).
    const today = todayUtc();
    const insertEvent = (
      loanId: Id<"loans">,
      type: Doc<"automationEvents">["type"],
      recipientRole: Doc<"automationEvents">["recipientRole"],
      at: number,
      failed = false,
    ) =>
      ctx.db.insert("automationEvents", {
        loanId,
        type,
        recipientRole,
        status: failed ? "failed" : "delivered",
        attempts: failed ? 5 : 1,
        ...(failed ? { lastErrorCode: "HTTP_503" } : { deliveredAt: at + 2000 }),
        createdAt: at,
        updatedAt: at + (failed ? 30 * 60_000 : 2000),
      });

    let failedLoanId: Id<"loans"> | undefined;
    for (const [j, l] of LOANS.entries()) {
      const tool = toolByName.get(l.tool);
      if (!tool) throw new Error(`Seed tool missing: ${l.tool}`);
      // Borrower is never the owner: offset 1..n-1 from the owner index.
      const borrowerIdx = tool.ownerIdx + 1 + (j % (n - 1));
      const createdAt = now - Math.max(1, -l.start + 3) * DAY - (j % 5) * 3_600_000;
      const decidedAt = createdAt + 6 * 3_600_000;
      const returnedAt = now + l.end * DAY;
      const loanId = await ctx.db.insert("loans", {
        toolId: tool.id,
        ownerId: user(tool.ownerIdx)._id,
        borrowerId: user(borrowerIdx)._id,
        startDate: addDays(today, l.start),
        endDate: addDays(today, l.end),
        status: l.status,
        ...(l.status !== "pending" && l.status !== "cancelled" ? { decidedAt } : {}),
        ...(l.status === "returned" ? { returnedAt } : {}),
        createdAt,
        updatedAt: l.status === "returned" ? returnedAt : l.status === "pending" ? createdAt : decidedAt,
      });

      if (l.status === "pending" && args.notify) {
        await enqueueLoanEvent(ctx, { loanId, type: "request_created", recipientRole: "owner" });
        continue;
      }
      await insertEvent(loanId, "request_created", "owner", createdAt);
      if (l.status === "approved" || l.status === "returned") {
        const failed = l.tool === FAILED_EVENT_TOOL;
        await insertEvent(loanId, "request_approved", "borrower", decidedAt, failed);
        if (failed) failedLoanId = loanId;
      }
      if (l.status === "returned") await insertEvent(loanId, "loan_returned", "owner", returnedAt);
      if (l.status === "declined") await insertEvent(loanId, "request_declined", "borrower", decidedAt);
      if (l.status === "cancelled") await insertEvent(loanId, "request_cancelled", "owner", createdAt + 3_600_000);
      if (l.tool === REMINDED_TOOL) {
        const yesterday = addDays(today, -1);
        await insertEvent(loanId, "overdue_reminder", "borrower", now - DAY + 9 * 3_600_000);
        await ctx.db.insert("reminders", {
          idempotencyKey: `${loanId}:${yesterday}`,
          loanId,
          reminderDate: yesterday,
          outcome: "sent",
          createdAt: now - DAY + 9 * 3_600_000,
        });
      }
    }

    // 5. One sanitized workflow error (no PII) for the admin errors tab.
    await ctx.db.insert("workflowErrors", {
      workflowName: "LendLoop: loan notifications",
      executionId: "1042",
      nodeName: "Send email",
      message: "SMTP connection timed out after 30 seconds",
      ...(failedLoanId ? { loanId: failedLoanId } : {}),
      createdAt: now - 2 * 3_600_000,
    });

    return { users: n, tools: TOOLS.length, loans: LOANS.length };
  },
});
