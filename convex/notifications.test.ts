import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { signWebhook } from "./lib/hmac";
import { BACKOFF_MS, MAX_ATTEMPTS } from "./notifications";
import { makeLoan, makeTool, makeUser, newT, NOW_ISO, type T } from "../tests/helpers";

const URL_ = "http://localhost:5678/webhook/lendloop-loan-events";
const SECRET = "test-webhook-secret";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  vi.stubEnv("N8N_WEBHOOK_URL", URL_);
  vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
  fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup(recipientRole: "owner" | "borrower" = "borrower") {
  const t = newT();
  const owner = await makeUser(t, "user_owner");
  const borrower = await makeUser(t, "user_borrower");
  await t.run(async (ctx) => {
    await ctx.db.patch("users", owner._id, { email: "owner@example.com" });
    await ctx.db.patch("users", borrower._id, { email: "borrower@example.com" });
  });
  const toolId = await makeTool(t, owner._id);
  const loanId = await makeLoan(t, toolId, owner._id, borrower._id);
  const eventId = await t.run((ctx) =>
    ctx.db.insert("automationEvents", {
      loanId,
      type: "request_created",
      recipientRole,
      status: "pending",
      attempts: 0,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  return { t, owner, borrower, toolId, loanId, eventId };
}

const getEvent = (t: T, id: Id<"automationEvents">) => t.run((ctx) => ctx.db.get("automationEvents", id));

describe("notifications.deliver", () => {
  it("success: signed request, exact minimal payload, marks delivered", async () => {
    const { t, eventId, loanId } = await setup("owner");
    await t.action(internal.notifications.deliver, { eventId });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_);
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    const rawBody = init.body as string;
    const ts = Number(h["X-LendLoop-Timestamp"]);
    expect(ts).toBe(Math.floor(new Date(NOW_ISO).getTime() / 1000));
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["X-LendLoop-Event-Id"]).toBe(eventId);
    expect(h["Idempotency-Key"]).toBe(eventId);
    expect(h["X-LendLoop-Signature"]).toBe(`sha256=${await signWebhook(SECRET, ts, rawBody)}`);
    expect(init.signal).toBeDefined();

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "endDate",
        "eventId",
        "eventType",
        "loanId",
        "loanStatus",
        "recipient",
        "startDate",
        "toolName",
      ].sort(),
    );
    expect(Object.keys(payload.recipient as object).sort()).toEqual(["email", "name"]);
    expect(payload).toMatchObject({
      eventId,
      eventType: "request_created",
      loanId,
      toolName: "Cordless drill",
      loanStatus: "pending",
      startDate: "2026-11-10",
      endDate: "2026-11-12",
      recipient: { name: "Name user_owner", email: "owner@example.com" },
    });
    expect(rawBody).not.toContain("borrower@example.com");
    expect(rawBody).not.toContain("18V drill");

    const ev = await getEvent(t, eventId);
    expect(ev).toMatchObject({ status: "delivered", attempts: 1 });
    expect(ev?.lastErrorCode).toBeUndefined();
  });

  it("borrower recipient receives the borrower's address", async () => {
    const { t, eventId } = await setup("borrower");
    await t.action(internal.notifications.deliver, { eventId });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.recipient.email).toBe("borrower@example.com");
  });

  it("503 is retried with the documented backoff, then delivered", async () => {
    const { t, eventId } = await setup();
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    await t.action(internal.notifications.deliver, { eventId });
    expect(await getEvent(t, eventId)).toMatchObject({
      status: "pending",
      attempts: 1,
      lastErrorCode: "HTTP_503",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] - 1);
    await t.finishInProgressScheduledFunctions();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await t.finishInProgressScheduledFunctions();
    expect(await getEvent(t, eventId)).toMatchObject({ status: "delivered", attempts: 2 });
  });

  it("backoff schedule is exponential and has MAX_ATTEMPTS - 1 retries", () => {
    expect(BACKOFF_MS.slice(0, MAX_ATTEMPTS - 1)).toEqual([30_000, 120_000, 480_000, 1_800_000]);
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it("401 fails immediately without retry", async () => {
    const { t, eventId } = await setup();
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await t.action(internal.notifications.deliver, { eventId });
    expect(await getEvent(t, eventId)).toMatchObject({
      status: "failed",
      attempts: 1,
      lastErrorCode: "HTTP_401",
    });
    await vi.runAllTimersAsync();
    await t.finishInProgressScheduledFunctions();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 and 408 are retryable", async () => {
    for (const status of [429, 408]) {
      const { t, eventId } = await setup();
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(new Response("", { status }));
      await t.action(internal.notifications.deliver, { eventId });
      expect(await getEvent(t, eventId)).toMatchObject({
        status: "pending",
        lastErrorCode: `HTTP_${status}`,
      });
    }
  });

  it("five consecutive failures end in failed after exactly 5 attempts", async () => {
    const { t, eventId } = await setup();
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await t.action(internal.notifications.deliver, { eventId });
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      await vi.advanceTimersByTimeAsync(BACKOFF_MS[i] ?? 0);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(i + 2));
      await t.finishInProgressScheduledFunctions();
    }
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(await getEvent(t, eventId)).toMatchObject({
      status: "failed",
      attempts: MAX_ATTEMPTS,
      lastErrorCode: "HTTP_500",
    });
    await vi.advanceTimersByTimeAsync(10 * 3_600_000);
    await t.finishInProgressScheduledFunctions();
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("timeout maps to TIMEOUT; network error maps to NETWORK (both retryable)", async () => {
    const a = await setup();
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await a.t.action(internal.notifications.deliver, { eventId: a.eventId });
    expect(await getEvent(a.t, a.eventId)).toMatchObject({
      status: "pending",
      lastErrorCode: "TIMEOUT",
    });
    const b = await setup();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await b.t.action(internal.notifications.deliver, { eventId: b.eventId });
    expect(await getEvent(b.t, b.eventId)).toMatchObject({
      status: "pending",
      lastErrorCode: "NETWORK",
    });
  });

  it("aborts the request after 10s", async () => {
    const { t, eventId } = await setup();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener("abort", () =>
            rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const p = t.action(internal.notifications.deliver, { eventId });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    expect(await getEvent(t, eventId)).toMatchObject({ lastErrorCode: "TIMEOUT", status: "pending" });
  });

  it("not configured -> failed NOT_CONFIGURED, no fetch, no retry", async () => {
    const { t, eventId } = await setup();
    vi.stubEnv("N8N_WEBHOOK_URL", "");
    await t.action(internal.notifications.deliver, { eventId });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await getEvent(t, eventId)).toMatchObject({
      status: "failed",
      lastErrorCode: "NOT_CONFIGURED",
      attempts: 0,
    });
  });

  it("recipient without email -> failed NO_RECIPIENT_EMAIL", async () => {
    const { t, eventId, borrower } = await setup("borrower");
    await t.run((ctx) => ctx.db.patch("users", borrower._id, { email: undefined }));
    await t.action(internal.notifications.deliver, { eventId });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await getEvent(t, eventId)).toMatchObject({
      status: "failed",
      lastErrorCode: "NO_RECIPIENT_EMAIL",
    });
  });

  it("is idempotent: an already-delivered event is not sent again", async () => {
    const { t, eventId } = await setup();
    await t.action(internal.notifications.deliver, { eventId });
    await t.action(internal.notifications.deliver, { eventId });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await t.mutation(internal.notifications.markFailed, { eventId, code: "X" });
    expect((await getEvent(t, eventId))?.status).toBe("delivered");
  });

  it("logs only event id, attempt and code (no email, url or secret)", async () => {
    const { t, eventId } = await setup();
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await t.action(internal.notifications.deliver, { eventId });
    const logged = JSON.stringify((console.log as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).toContain(eventId);
    expect(logged).toContain("HTTP_500");
    for (const bad of ["@", "localhost", SECRET, "drill"]) expect(logged).not.toContain(bad);
  });

  it("enqueueLoanEvent schedules delivery (loan transition -> event delivered)", async () => {
    const { t, loanId } = await setup();
    const id = await t.run((ctx) =>
      import("./lib/notify").then((m) =>
        m.enqueueLoanEvent(ctx, { loanId, type: "request_approved", recipientRole: "borrower" }),
      ),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await getEvent(t, id))?.status).toBe("delivered");
  });
});
