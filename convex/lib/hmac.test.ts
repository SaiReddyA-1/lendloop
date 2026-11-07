import { describe, expect, it } from "vitest";
import { hmacSha256Hex, signWebhook, timingSafeEqualStr, verifyBearer } from "./hmac";

describe("hmacSha256Hex", () => {
  it("matches RFC 4231 test case 2", async () => {
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("changes when key or message change (tamper)", async () => {
    const base = await hmacSha256Hex("k", "m");
    expect(await hmacSha256Hex("k", "m2")).not.toBe(base);
    expect(await hmacSha256Hex("k2", "m")).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("signWebhook", () => {
  it("signs `${timestamp}.${body}`", async () => {
    const sig = await signWebhook("secret", 1700000000, '{"a":1}');
    expect(sig).toBe(await hmacSha256Hex("secret", '1700000000.{"a":1}'));
  });

  it("binds the timestamp and the body", async () => {
    const sig = await signWebhook("secret", 1700000000, '{"a":1}');
    expect(await signWebhook("secret", 1700000001, '{"a":1}')).not.toBe(sig);
    expect(await signWebhook("secret", 1700000000, '{"a":2}')).not.toBe(sig);
  });
});

describe("timingSafeEqualStr", () => {
  it("equal / unequal / different length / empty", async () => {
    expect(await timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(await timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(await timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(await timingSafeEqualStr("", "")).toBe(true);
    expect(await timingSafeEqualStr("", "a")).toBe(false);
  });
});

describe("verifyBearer", () => {
  it("accepts the exact token", async () => {
    expect(await verifyBearer("Bearer tok123", "tok123")).toBe(true);
    expect(await verifyBearer("bearer tok123", "tok123")).toBe(true);
  });

  it("rejects wrong, missing and malformed headers", async () => {
    expect(await verifyBearer("Bearer nope", "tok123")).toBe(false);
    expect(await verifyBearer("Bearer tok1234", "tok123")).toBe(false);
    expect(await verifyBearer(null, "tok123")).toBe(false);
    expect(await verifyBearer(undefined, "tok123")).toBe(false);
    expect(await verifyBearer("", "tok123")).toBe(false);
    expect(await verifyBearer("tok123", "tok123")).toBe(false);
    expect(await verifyBearer("Basic tok123", "tok123")).toBe(false);
    expect(await verifyBearer("Bearer ", "tok123")).toBe(false);
    expect(await verifyBearer("Bearer a b", "a b")).toBe(false);
  });

  it("fails closed when the expected token is empty", async () => {
    expect(await verifyBearer("Bearer ", "")).toBe(false);
    expect(await verifyBearer("Bearer x", "")).toBe(false);
  });
});
