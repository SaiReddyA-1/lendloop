import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { n8nWebhookSecret, n8nWebhookUrl } from "./lib/env";
import { signWebhook } from "./lib/hmac";

/** Max delivery attempts per event (first try + retries). Single source of truth. */
export const MAX_ATTEMPTS = 5;
/** Delay before retry N (index 0 = after attempt 1). Length must be MAX_ATTEMPTS - 1. */
export const BACKOFF_MS = [30_000, 120_000, 480_000, 1_800_000, 7_200_000] as const;
// Must exceed n8n WF1 worst case (email node: 3 tries x 5s wait) so Convex does not time out while n8n is still retrying.
export const DELIVERY_TIMEOUT_MS = 30_000;

export type NotificationPayload = {
  eventId: string;
  eventType: string;
  loanId: string;
  toolName: string;
  loanStatus: string;
  startDate: string;
  endDate: string;
  recipient: { name: string; email: string };
};

const payloadResultValidator = v.union(
  v.object({ kind: v.literal("skip") }),
  v.object({ kind: v.literal("error"), code: v.string() }),
  v.object({
    kind: v.literal("payload"),
    payload: v.object({
      eventId: v.string(),
      eventType: v.string(),
      loanId: v.string(),
      toolName: v.string(),
      loanStatus: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      recipient: v.object({ name: v.string(), email: v.string() }),
    }),
  }),
);

/**
 * Minimal outbound payload ONLY (data minimization): no user ids, no tool
 * description, no other party's email.
 */
export const buildPayload = internalQuery({
  args: { eventId: v.id("automationEvents") },
  returns: payloadResultValidator,
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get("automationEvents", eventId);
    if (!event || event.status !== "pending") return { kind: "skip" as const };
    const loan = await ctx.db.get("loans", event.loanId);
    if (!loan) return { kind: "error" as const, code: "LOAN_NOT_FOUND" };
    const [tool, recipient] = await Promise.all([
      ctx.db.get("tools", loan.toolId),
      ctx.db.get(
        "users",
        event.recipientRole === "owner"
          ? loan.ownerId
          : event.recipientRole === "borrower"
            ? loan.borrowerId
            : loan.ownerId,
      ),
    ]);
    if (event.recipientRole === "admin") return { kind: "error" as const, code: "NO_RECIPIENT_EMAIL" };
    if (!recipient?.email) return { kind: "error" as const, code: "NO_RECIPIENT_EMAIL" };
    return {
      kind: "payload" as const,
      payload: {
        eventId: event._id,
        eventType: event.type,
        loanId: loan._id,
        toolName: tool?.name ?? "Removed tool",
        loanStatus: loan.status,
        startDate: loan.startDate,
        endDate: loan.endDate,
        recipient: { name: recipient.name, email: recipient.email },
      },
    };
  },
});

/** Increments attempts and records the last error code (cleared on success). Returns the new attempt count. */
export const recordAttempt = internalMutation({
  args: { eventId: v.id("automationEvents"), code: v.optional(v.string()) },
  returns: v.number(),
  handler: async (ctx, { eventId, code }) => {
    const event = await ctx.db.get("automationEvents", eventId);
    if (!event) return 0;
    if (event.status === "delivered") return event.attempts;
    const attempts = event.attempts + 1;
    await ctx.db.patch("automationEvents", eventId, {
      attempts,
      lastErrorCode: code,
      updatedAt: Date.now(),
    });
    return attempts;
  },
});

export const markDelivered = internalMutation({
  args: { eventId: v.id("automationEvents") },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get("automationEvents", eventId);
    if (!event || event.status === "delivered") return null;
    const now = Date.now();
    await ctx.db.patch("automationEvents", eventId, {
      status: "delivered",
      lastErrorCode: undefined,
      nextAttemptAt: undefined,
      deliveredAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { eventId: v.id("automationEvents"), code: v.string() },
  returns: v.null(),
  handler: async (ctx, { eventId, code }) => {
    const event = await ctx.db.get("automationEvents", eventId);
    if (!event || event.status === "delivered") return null;
    await ctx.db.patch("automationEvents", eventId, {
      status: "failed",
      lastErrorCode: code.slice(0, 40),
      nextAttemptAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const scheduleRetry = internalMutation({
  args: { eventId: v.id("automationEvents"), delayMs: v.number() },
  returns: v.null(),
  handler: async (ctx, { eventId, delayMs }) => {
    const event = await ctx.db.get("automationEvents", eventId);
    if (!event || event.status !== "pending") return null;
    await ctx.db.patch("automationEvents", eventId, { nextAttemptAt: Date.now() + delayMs });
    await ctx.scheduler.runAfter(delayMs, internal.notifications.deliver, { eventId });
    return null;
  },
});

function log(eventId: string, attempt: number, code: string) {
  // Ids and codes only. Never log payloads, emails, URLs or secrets.
  console.log(JSON.stringify({ evt: "notify.deliver", eventId, attempt, code }));
}

export const deliver = internalAction({
  args: { eventId: v.id("automationEvents") },
  returns: v.null(),
  handler: async (ctx, { eventId }): Promise<null> => {
    const built = await ctx.runQuery(internal.notifications.buildPayload, { eventId });
    if (built.kind === "skip") return null;
    if (built.kind === "error") {
      await ctx.runMutation(internal.notifications.markFailed, { eventId, code: built.code });
      log(eventId, 0, built.code);
      return null;
    }

    const url = n8nWebhookUrl();
    const secret = n8nWebhookSecret();
    if (!url || !secret) {
      await ctx.runMutation(internal.notifications.markFailed, { eventId, code: "NOT_CONFIGURED" });
      log(eventId, 0, "NOT_CONFIGURED");
      return null;
    }

    const rawBody = JSON.stringify(built.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signWebhook(secret, timestamp, rawBody);

    let code: string | undefined;
    let retryable = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LendLoop-Timestamp": String(timestamp),
          "X-LendLoop-Signature": `sha256=${signature}`,
          "X-LendLoop-Event-Id": eventId,
          "Idempotency-Key": eventId,
        },
        body: rawBody,
        signal: controller.signal,
        redirect: "error",
      });
      if (!res.ok) {
        code = `HTTP_${res.status}`;
        retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      }
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      code = name === "AbortError" || name === "TimeoutError" ? "TIMEOUT" : "NETWORK";
    } finally {
      clearTimeout(timer);
    }

    const attempt = await ctx.runMutation(internal.notifications.recordAttempt, { eventId, code });
    if (code === undefined) {
      await ctx.runMutation(internal.notifications.markDelivered, { eventId });
      log(eventId, attempt, "OK");
      return null;
    }
    log(eventId, attempt, code);
    const delay = BACKOFF_MS[attempt - 1];
    if (retryable && attempt < MAX_ATTEMPTS && delay !== undefined) {
      await ctx.runMutation(internal.notifications.scheduleRetry, { eventId, delayMs: delay });
    } else {
      await ctx.runMutation(internal.notifications.markFailed, { eventId, code });
    }
    return null;
  },
});
