"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toErrorMessage } from "@/lib/errors";

export type PhotoChange = { file: File | null; remove: boolean };

/**
 * Applies a photo change after the tool itself is saved: upload (generateUploadUrl, POST, attachPhoto) or removal.
 * Client checks are only UX; the server re-validates type, size and content. Resolves true when nothing is left
 * to retry; on failure it toasts and resolves false (the tool itself is already saved).
 */
export function useToolPhotoSync() {
  const generateUploadUrl = useMutation(api.toolPhotos.generateUploadUrl);
  const attachPhoto = useMutation(api.toolPhotos.attachPhoto);
  const removePhoto = useMutation(api.toolPhotos.removePhoto);
  const [pending, setPending] = useState(false);

  const sync = useCallback(
    async (toolId: Id<"tools">, change: PhotoChange): Promise<boolean> => {
      if (!change.file && !change.remove) return true;
      setPending(true);
      try {
        if (change.file) {
          const url = await generateUploadUrl();
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": change.file.type },
            body: change.file,
          });
          if (!res.ok) throw new Error("upload failed");
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
          const result = await attachPhoto({ toolId, storageId });
          if (!result.ok) {
            toast.error(`Saved, but the photo was not added. ${result.message}`);
            return false;
          }
        } else {
          await removePhoto({ toolId });
        }
        return true;
      } catch (e) {
        const msg = toErrorMessage(e);
        toast.error(`Saved, but the photo was not updated. ${msg}`);
        return false;
      } finally {
        setPending(false);
      }
    },
    [generateUploadUrl, attachPhoto, removePhoto],
  );

  return { sync, pending };
}
