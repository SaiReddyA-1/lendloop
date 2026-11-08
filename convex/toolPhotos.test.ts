import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sniffImageType } from "./lib/imageSniff";
import { LIMITS } from "./lib/validation";
import { ORPHAN_AFTER_MS } from "./toolPhotos";
import { identity, makeTool, makeUser, newT, NOW_ISO, type T } from "../tests/helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
});
afterEach(() => vi.useRealTimers());

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

function blob(head: number[], type: string, extra = 0) {
  const bytes = new Uint8Array(head.length + extra);
  bytes.set(head);
  return new Blob([bytes], { type });
}
const store = (t: T, b: Blob) => t.run((ctx) => ctx.storage.store(b));
const exists = (t: T, id: Id<"_storage">) => t.run(async (ctx) => (await ctx.storage.get(id)) !== null);

async function setup() {
  const t = newT();
  const a = await makeUser(t, "user_a");
  const b = await makeUser(t, "user_b");
  const toolA = await makeTool(t, a._id);
  return {
    t,
    a,
    b,
    toolA,
    as: (sub: string) => t.withIdentity(identity(sub, { email: `${sub}@example.com` })),
  };
}

describe("sniffImageType", () => {
  it("recognizes jpeg, png, webp and rejects the rest", () => {
    expect(sniffImageType(new Uint8Array(JPEG_HEAD))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array(PNG_HEAD))).toBe("image/png");
    expect(sniffImageType(new Uint8Array(WEBP_HEAD))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});

describe("toolPhotos: authentication", () => {
  it("every function requires sign-in", async () => {
    const { t, toolA } = await setup();
    const storageId = await store(t, blob(PNG_HEAD, "image/png"));
    await expect(t.mutation(api.toolPhotos.generateUploadUrl, {})).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
    await expect(
      t.mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId }),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    await expect(t.mutation(api.toolPhotos.removePhoto, { toolId: toolA })).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
  });
});

describe("toolPhotos: attach", () => {
  it("owner attaches a valid photo; photoUrl appears in list, listMine and get", async () => {
    const { t, toolA, as } = await setup();
    const storageId = await store(t, blob(PNG_HEAD, "image/png", 100));
    expect(await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId })).toEqual({
      ok: true,
    });
    const board = await as("user_b").query(api.tools.list, {});
    expect(board[0]?.photoUrl).toEqual(expect.any(String));
    const mine = await as("user_a").query(api.tools.listMine, {});
    expect(mine[0]?.photoUrl).toEqual(expect.any(String));
    const detail = await as("user_b").query(api.tools.get, { toolId: toolA });
    expect(detail.photoUrl).toEqual(expect.any(String));
  });

  it("photoUrl is null for tools without a photo", async () => {
    const { toolA, as } = await setup();
    const board = await as("user_b").query(api.tools.list, {});
    expect(board.find((x) => x._id === toolA)?.photoUrl).toBeNull();
  });

  it("another user gets NOT_FOUND and the tool is unchanged", async () => {
    const { t, toolA, as } = await setup();
    const storageId = await store(t, blob(PNG_HEAD, "image/png"));
    await expect(
      as("user_b").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    const tool = await t.run((ctx) => ctx.db.get("tools", toolA));
    expect(tool?.photoId).toBeUndefined();
  });

  it("rejects a disallowed content type and deletes the file", async () => {
    const { t, toolA, as } = await setup();
    const storageId = await store(t, new Blob(["<svg/>"], { type: "image/svg+xml" }));
    const res = await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId });
    expect(res).toMatchObject({ ok: false });
    expect(await exists(t, storageId)).toBe(false);
    expect((await t.run((ctx) => ctx.db.get("tools", toolA)))?.photoId).toBeUndefined();
  });

  it("rejects an oversize file and deletes it", async () => {
    const { t, toolA, as } = await setup();
    const storageId = await store(t, blob(PNG_HEAD, "image/png", LIMITS.PHOTO_MAX_BYTES));
    const res = await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId });
    expect(res).toMatchObject({ ok: false });
    expect(await exists(t, storageId)).toBe(false);
  });

  it("accepts a file of exactly the maximum size", async () => {
    const { t, toolA, as } = await setup();
    const storageId = await store(t, blob(PNG_HEAD, "image/png", LIMITS.PHOTO_MAX_BYTES - PNG_HEAD.length));
    expect(await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId })).toEqual({
      ok: true,
    });
  });

  it("rejects a file whose bytes do not match the declared type and deletes it", async () => {
    const { t, toolA, as } = await setup();
    const storageId = await store(t, new Blob(["<html><script>1</script></html>"], { type: "image/png" }));
    const res = await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId });
    expect(res).toMatchObject({ ok: false });
    expect(await exists(t, storageId)).toBe(false);
  });

  it("rejects a jpeg declared as png (mismatch)", async () => {
    const { t, toolA, as } = await setup();
    const storageId = await store(t, blob(JPEG_HEAD, "image/png"));
    expect(
      await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId }),
    ).toMatchObject({ ok: false });
  });

  it("replacing a photo deletes the previous file", async () => {
    const { t, toolA, as } = await setup();
    const first = await store(t, blob(JPEG_HEAD, "image/jpeg"));
    const second = await store(t, blob(WEBP_HEAD, "image/webp"));
    await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId: first });
    await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId: second });
    expect(await exists(t, first)).toBe(false);
    expect(await exists(t, second)).toBe(true);
    expect((await t.run((ctx) => ctx.db.get("tools", toolA)))?.photoId).toBe(second);
  });

  it("never attaches or deletes a file that another tool already uses", async () => {
    const { t, a, toolA, as } = await setup();
    const other = await makeTool(t, a._id);
    const storageId = await store(t, blob(PNG_HEAD, "image/png"));
    await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId });
    const res = await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: other, storageId });
    expect(res).toMatchObject({ ok: false });
    expect(await exists(t, storageId)).toBe(true);
  });

  it("a removed tool refuses a photo and the file is deleted", async () => {
    const { t, toolA, as } = await setup();
    await t.run((ctx) => ctx.db.patch("tools", toolA, { status: "removed" }));
    const storageId = await store(t, blob(PNG_HEAD, "image/png"));
    const res = await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId });
    expect(res).toMatchObject({ ok: false });
    expect(await exists(t, storageId)).toBe(false);
  });
});

describe("toolPhotos: remove", () => {
  it("owner removal deletes the file and unsets photoId; other users get NOT_FOUND", async () => {
    const { t, toolA, as } = await setup();
    const storageId = await store(t, blob(PNG_HEAD, "image/png"));
    await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId });
    await expect(as("user_b").mutation(api.toolPhotos.removePhoto, { toolId: toolA })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
    expect(await exists(t, storageId)).toBe(true);
    await as("user_a").mutation(api.toolPhotos.removePhoto, { toolId: toolA });
    expect(await exists(t, storageId)).toBe(false);
    expect((await t.run((ctx) => ctx.db.get("tools", toolA)))?.photoId).toBeUndefined();
    // Idempotent.
    await as("user_a").mutation(api.toolPhotos.removePhoto, { toolId: toolA });
  });
});

describe("toolPhotos: tool removal deletes the photo", () => {
  it("owner removal", async () => {
    const { t, toolA, as } = await setup();
    const storageId = await store(t, blob(PNG_HEAD, "image/png"));
    await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId });
    await as("user_a").mutation(api.tools.remove, { toolId: toolA });
    expect(await exists(t, storageId)).toBe(false);
    expect((await t.run((ctx) => ctx.db.get("tools", toolA)))?.photoId).toBeUndefined();
  });

  it("admin removal", async () => {
    const { t, toolA, as } = await setup();
    await makeUser(t, "user_admin", { role: "admin" });
    const storageId = await store(t, blob(PNG_HEAD, "image/png"));
    await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId });
    await as("user_admin").mutation(api.admin.removeTool, { toolId: toolA, reason: "Policy breach" });
    expect(await exists(t, storageId)).toBe(false);
  });
});

describe("tools.listPublic projection", () => {
  it("stays exactly { name, category } even with a photo", async () => {
    const { t, toolA, as } = await setup();
    const storageId = await store(t, blob(PNG_HEAD, "image/png"));
    await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId });
    const rows = await t.query(api.tools.listPublic, {});
    expect(rows).toEqual([{ name: "Cordless drill", category: "power_tools" }]);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["category", "name"]);
  });
});

describe("toolPhotos: upload rate limit", () => {
  it("allows 20 per hour per user, then RATE_LIMITED; other users and later hours unaffected", async () => {
    const { as } = await setup();
    for (let i = 0; i < LIMITS.MAX_UPLOADS_PER_HOUR; i++) {
      await expect(as("user_a").mutation(api.toolPhotos.generateUploadUrl, {})).resolves.toEqual(
        expect.any(String),
      );
    }
    await expect(as("user_a").mutation(api.toolPhotos.generateUploadUrl, {})).rejects.toMatchObject({
      data: { code: "RATE_LIMITED" },
    });
    await expect(as("user_b").mutation(api.toolPhotos.generateUploadUrl, {})).resolves.toEqual(
      expect.any(String),
    );
    vi.setSystemTime(new Date(NOW_ISO).getTime() + 3_700_000);
    await expect(as("user_a").mutation(api.toolPhotos.generateUploadUrl, {})).resolves.toEqual(
      expect.any(String),
    );
  });
});

describe("toolPhotos: orphan cleanup", () => {
  it("deletes old unreferenced files only; keeps attached and recent ones; trims old intents", async () => {
    const { t, toolA, as } = await setup();
    const attached = await store(t, blob(PNG_HEAD, "image/png"));
    await as("user_a").mutation(api.toolPhotos.attachPhoto, { toolId: toolA, storageId: attached });
    const orphan = await store(t, blob(PNG_HEAD, "image/png"));
    await as("user_a").mutation(api.toolPhotos.generateUploadUrl, {});

    vi.setSystemTime(new Date(NOW_ISO).getTime() + ORPHAN_AFTER_MS / 2);
    const recent = await store(t, blob(PNG_HEAD, "image/png"));
    vi.setSystemTime(new Date(NOW_ISO).getTime() + 3 * 3_600_000);
    const fresh = await store(t, blob(PNG_HEAD, "image/png"));

    await t.mutation(internal.toolPhotos.cleanupOrphans, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await exists(t, orphan)).toBe(false);
    expect(await exists(t, recent)).toBe(false); // 3h old by now and unreferenced
    expect(await exists(t, attached)).toBe(true);
    expect(await exists(t, fresh)).toBe(true);
    const intents = await t.run((ctx) => ctx.db.query("uploadIntents").collect());
    expect(intents).toHaveLength(0);
  });

  it("does not delete a file younger than the orphan window", async () => {
    const { t } = await setup();
    const young = await store(t, blob(PNG_HEAD, "image/png"));
    vi.setSystemTime(new Date(NOW_ISO).getTime() + ORPHAN_AFTER_MS - 1000);
    await t.mutation(internal.toolPhotos.cleanupOrphans, {});
    expect(await exists(t, young)).toBe(true);
  });
});
