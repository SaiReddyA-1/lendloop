import { ConvexError } from "convex/values";

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "USER_NOT_PROVISIONED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "RATE_LIMITED";

export type AppErrorData = { code: AppErrorCode; message: string };

/**
 * Structured, end-user-safe error. Messages must never contain other users'
 * ids, stack info, or raw input. The UI switches on `data.code`.
 */
export function appError(code: AppErrorCode, message: string): ConvexError<AppErrorData> {
  return new ConvexError<AppErrorData>({ code, message });
}
