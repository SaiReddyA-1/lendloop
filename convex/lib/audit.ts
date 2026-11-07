import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { LIMITS, sanitizeText } from "./validation";

export type AuditAction = Doc<"auditLog">["action"];
export type AuditTargetType = Doc<"auditLog">["targetType"];

/** Appends an audit row. Never put PII or free-form payloads in `reason`. */
export async function writeAudit(
  ctx: MutationCtx,
  args: {
    actor: Doc<"users"> | "system:bootstrap" | "system:cli";
    action: AuditAction;
    targetType: AuditTargetType;
    targetId: string;
    reason?: string;
  },
): Promise<void> {
  const reason =
    args.reason === undefined ? undefined : sanitizeText(args.reason).slice(0, LIMITS.REASON_MAX);
  await ctx.db.insert("auditLog", {
    ...(typeof args.actor === "string" ? {} : { actorId: args.actor._id }),
    actorLabel: typeof args.actor === "string" ? args.actor : "user",
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    ...(reason ? { reason } : {}),
    createdAt: Date.now(),
  });
}
