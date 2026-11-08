import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { requireToolOwner, requireUser } from "./lib/auth";
import { appError } from "./lib/errors";
import { sniffImageType } from "./lib/imageSniff";
import { LIMITS, PHOTO_CONTENT_TYPES } from "./lib/validation";

const HOUR_MS = 3_600_000;
/** Uploaded files older than this that no tool references are orphans (abandoned or rejected uploads). */
export const ORPHAN_AFTER_MS = HOUR_MS;
/** Upload ledger rows are only needed for the rate-limit window; keep a little longer, then trim. */
const INTENT_RETENTION_MS = 2 * HOUR_MS;
const CLEANUP_PAGE = 100;

const attachResultValidator = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), message: v.string() }),
);

async function isReferenced(ctx: MutationCtx, storageId: Id<"_storage">): Promise<boolean> {
  const row = await ctx.db
    .query("tools")
    .withIndex("by_photoId", (q) => q.eq("photoId", storageId))
    .first();
  return row !== null;
}

// AUTH: requireUser. Issues a one-shot upload URL; rate limited to 20 per rolling hour per user (API4).
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const now = Date.now();
    const recent = await ctx.db
      .query("uploadIntents")
      .withIndex("by_user_created", (q) => q.eq("userId", me._id).gte("createdAt", now - HOUR_MS))
      .take(LIMITS.MAX_UPLOADS_PER_HOUR);
    if (recent.length >= LIMITS.MAX_UPLOADS_PER_HOUR) {
      throw appError("RATE_LIMITED", "You're uploading too quickly. Please try again later.");
    }
    await ctx.db.insert("uploadIntents", { userId: me._id, createdAt: now });
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Validates an uploaded file and returns a rejection message (null = fine). Checks, in order: metadata exists,
 * declared type is allow-listed, size cap, and the magic bytes agree with the declared type.
 */
async function rejectionFor(ctx: MutationCtx, storageId: Id<"_storage">): Promise<string | null> {
  const meta = await ctx.db.system.get("_storage", storageId);
  if (!meta) return "That upload could not be found. Please try again.";
  const type = meta.contentType;
  if (!type || !(PHOTO_CONTENT_TYPES as readonly string[]).includes(type)) {
    return "Photos must be JPG, PNG or WebP.";
  }
  if (meta.size > LIMITS.PHOTO_MAX_BYTES) {
    return `Photos must be at most ${LIMITS.PHOTO_MAX_BYTES / (1024 * 1024)} MB.`;
  }
  const blob = await ctx.storage.get(storageId);
  if (!blob) return "That upload could not be found. Please try again.";
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (sniffImageType(head) !== type) return "That file is not a valid image.";
  return null;
}

// AUTH: requireToolOwner (owner only). Convex rolls back every write of a throwing mutation, including a file
// delete, so a rejected upload is deleted and reported as `{ ok: false }` (a throw would silently undo the delete).
export const attachPhoto = mutation({
  args: { toolId: v.id("tools"), storageId: v.id("_storage") },
  returns: attachResultValidator,
  handler: async (ctx, args) => {
    const { tool } = await requireToolOwner(ctx, args.toolId);
    // A file already attached to a tool (this one or another) is never re-attached or deleted here.
    if (await isReferenced(ctx, args.storageId)) {
      return { ok: false as const, message: "That upload could not be used. Please try again." };
    }
    const exists = (await ctx.db.system.get("_storage", args.storageId)) !== null;
    if (tool.status !== "active") {
      if (exists) await ctx.storage.delete(args.storageId);
      return { ok: false as const, message: "This tool has been removed and can't be edited." };
    }
    const problem = await rejectionFor(ctx, args.storageId);
    if (problem !== null) {
      if (exists) await ctx.storage.delete(args.storageId);
      return { ok: false as const, message: problem };
    }
    if (tool.photoId) await ctx.storage.delete(tool.photoId);
    await ctx.db.patch("tools", tool._id, { photoId: args.storageId, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

// AUTH: requireToolOwner (owner only). Idempotent: no photo is a no-op.
export const removePhoto = mutation({
  args: { toolId: v.id("tools") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { tool } = await requireToolOwner(ctx, args.toolId);
    if (tool.photoId) {
      await ctx.storage.delete(tool.photoId);
      await ctx.db.patch("tools", tool._id, { photoId: undefined, updatedAt: Date.now() });
    }
    return null;
  },
});

/**
 * Cron (crons.ts): deletes uploaded files older than ORPHAN_AFTER_MS that no tool references, and trims old
 * rate-limit ledger rows. The `_storage` system table is read page by page (CLEANUP_PAGE per transaction) and
 * the function re-schedules itself with the cursor until the table is exhausted, so no run is unbounded.
 */
export const cleanupOrphans = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const now = Date.now();
    const cutoff = now - ORPHAN_AFTER_MS;
    const page = await ctx.db.system
      .query("_storage")
      .paginate({ numItems: CLEANUP_PAGE, cursor: cursor ?? null });
    for (const file of page.page) {
      if (file._creationTime >= cutoff) continue;
      if (await isReferenced(ctx, file._id)) continue;
      await ctx.storage.delete(file._id);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.toolPhotos.cleanupOrphans, {
        cursor: page.continueCursor,
      });
    } else {
      const stale = await ctx.db
        .query("uploadIntents")
        .withIndex("by_createdAt", (q) => q.lt("createdAt", now - INTENT_RETENTION_MS))
        .take(CLEANUP_PAGE);
      for (const row of stale) await ctx.db.delete("uploadIntents", row._id);
      if (stale.length === CLEANUP_PAGE) {
        await ctx.scheduler.runAfter(0, internal.toolPhotos.cleanupOrphans, { cursor: null });
      }
    }
    return null;
  },
});
