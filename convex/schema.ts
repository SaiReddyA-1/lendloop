import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  auditActionValidator,
  auditTargetTypeValidator,
  automationEventTypeValidator,
  automationStatusValidator,
  categoryValidator,
  conditionValidator,
  loanStatusValidator,
  recipientRoleValidator,
  reminderOutcomeValidator,
  roleValidator,
  toolStatusValidator,
} from "./lib/validation";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkUserId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    role: roleValidator,
    trustedLender: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_clerkUserId", ["clerkUserId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    status: toolStatusValidator,
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Kept deliberately: by_status sorts by _creationTime (newest-first listing); by_status_category sorts by category.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_status", ["status"])
    .index("by_status_category", ["status", "category"])
    .index("by_owner", ["ownerId", "status"])
    .index("by_owner_created", ["ownerId", "createdAt"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"), // denormalized from tools.ownerId
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId", "status"])
    .index("by_owner", ["ownerId", "status"])
    .index("by_status_endDate", ["status", "endDate"])
    .index("by_borrower_created", ["borrowerId", "createdAt"])
    .index("by_borrower_tool_created", ["borrowerId", "toolId", "createdAt"]),

  automationEvents: defineTable({
    loanId: v.id("loans"),
    type: automationEventTypeValidator,
    recipientRole: recipientRoleValidator,
    status: automationStatusValidator,
    attempts: v.number(),
    lastErrorCode: v.optional(v.string()), // short code only; never payloads/PII
    nextAttemptAt: v.optional(v.number()), // set while a retry is scheduled
    deliveredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_loan", ["loanId", "createdAt"])
    // Sweeper (stuck pending) and admin failed-event list; sorted by updatedAt within a status.
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  reminders: defineTable({
    idempotencyKey: v.string(), // `${loanId}:${YYYY-MM-DD}`
    loanId: v.id("loans"),
    reminderDate: v.string(),
    outcome: reminderOutcomeValidator,
    createdAt: v.number(),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  // Written by the n8n error workflow (POST /api/n8n/automation-events). Sanitized, truncated, email-redacted.
  workflowErrors: defineTable({
    workflowName: v.string(), // <= 100
    executionId: v.string(), // <= 64
    nodeName: v.optional(v.string()), // <= 100
    message: v.string(), // <= 300
    loanId: v.optional(v.id("loans")),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  auditLog: defineTable({
    actorId: v.optional(v.id("users")), // absent = system
    actorLabel: v.string(), // e.g. "system:bootstrap", "user"
    action: auditActionValidator,
    targetType: auditTargetTypeValidator,
    targetId: v.string(),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_target", ["targetType", "targetId"]),
});
