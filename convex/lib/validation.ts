import { v } from "convex/values";
import { appError } from "./errors";

export const CATEGORIES = [
  { value: "power_tools", label: "Power tools" },
  { value: "hand_tools", label: "Hand tools" },
  { value: "garden", label: "Garden" },
  { value: "kitchen", label: "Kitchen" },
  { value: "camping", label: "Camping" },
  { value: "cleaning", label: "Cleaning" },
  { value: "other", label: "Other" },
] as const;

export const CONDITIONS = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "worn", label: "Worn" },
] as const;

export const categoryValidator = v.union(
  v.literal("power_tools"),
  v.literal("hand_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("other"),
);
export const conditionValidator = v.union(
  v.literal("new"),
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);
export const toolStatusValidator = v.union(v.literal("active"), v.literal("removed"));
export const roleValidator = v.union(v.literal("admin"), v.literal("user"));
export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);
export const automationEventTypeValidator = v.union(
  v.literal("request_created"),
  v.literal("request_approved"),
  v.literal("request_declined"),
  v.literal("request_cancelled"),
  v.literal("loan_returned"),
  v.literal("overdue_reminder"),
  v.literal("workflow_error"),
);
export const recipientRoleValidator = v.union(
  v.literal("owner"),
  v.literal("borrower"),
  v.literal("admin"),
);
export const automationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("delivered"),
  v.literal("failed"),
  v.literal("duplicate"),
);
export const reminderOutcomeValidator = v.union(v.literal("sent"), v.literal("failed"));
export const auditActionValidator = v.union(
  v.literal("user.role.promote"),
  v.literal("user.role.demote"),
  v.literal("user.trusted.grant"),
  v.literal("user.trusted.revoke"),
  v.literal("tool.remove"),
  v.literal("automation.retry"),
);
export const auditTargetTypeValidator = v.union(
  v.literal("user"),
  v.literal("tool"),
  v.literal("loan"),
);

export const LIMITS = {
  TOOL_NAME_MIN: 2,
  TOOL_NAME_MAX: 80,
  DESCRIPTION_MAX: 500,
  REASON_MAX: 200,
  USER_NAME_MAX: 80,
  MAX_LOAN_DAYS: 30,
  MAX_PENDING_PER_BORROWER: 5,
  MAX_REQUESTS_PER_HOUR: 10,
  MAX_REQUESTS_PER_TOOL_PER_DAY: 2,
  MAX_TOOL_CREATES_PER_HOUR: 10,
  PHOTO_MAX_BYTES: 2 * 1024 * 1024,
  MAX_UPLOADS_PER_HOUR: 20,
} as const;

/** Accepted tool photo types (no SVG: it can carry script). Shared by the server check and the client pre-check. */
export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];

// Control chars (C0, DEL, C1).
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
// Zero-width, bidi override/isolate and BOM format chars: invisible, enable spoofing (e.g. RLO). Removed outright.
const FORMAT_CHARS = /[​-‏‪-‮⁠-⁩﻿]/g;

/** Strip zero-width/bidi format chars and control characters, collapse whitespace runs into one space, trim. */
export function sanitizeText(value: string): string {
  return value.replace(FORMAT_CHARS, "").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

/**
 * Trims `value` and enforces `min <= length <= max`. Returns the trimmed value;
 * throws a VALIDATION AppError otherwise. Does not collapse whitespace
 * (use sanitizeText first for single-line fields).
 */
export function assertLength(field: string, value: string, min: number, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw appError(
      "VALIDATION",
      min > 0
        ? `${field} must be between ${min} and ${max} characters.`
        : `${field} must be at most ${max} characters.`,
    );
  }
  return trimmed;
}
