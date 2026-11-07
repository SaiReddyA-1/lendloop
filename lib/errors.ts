import { ConvexError } from "convex/values";

export const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Safe, user-facing message. Only structured `ConvexError` payloads from our own
 * backend (`{ code, message }`) are shown; everything else (network errors,
 * server stack text) falls back to a generic sentence.
 */
export function toErrorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const data: unknown = e.data;
    if (
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string" &&
      data.message.length > 0 &&
      data.message.length <= 300
    ) {
      return data.message;
    }
  }
  return GENERIC_ERROR;
}
