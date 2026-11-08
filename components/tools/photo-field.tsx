"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { LIMITS, PHOTO_CONTENT_TYPES } from "@/convex/lib/validation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ToolImage } from "./tool-image";

const MAX_MB = LIMITS.PHOTO_MAX_BYTES / (1024 * 1024);

/** Client-side pre-check only (UX). The server validates type, size and file content again. */
export function checkPhotoFile(file: File): string | null {
  if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return "Choose a JPG, PNG or WebP image.";
  }
  if (file.size > LIMITS.PHOTO_MAX_BYTES) return `That image is too large. The limit is ${MAX_MB} MB.`;
  return null;
}

/**
 * Optional photo input with preview. Presentational: the parent owns the selected file and the "remove" flag.
 * `currentUrl` is the already saved photo (edit mode).
 */
export function PhotoField({
  name,
  category,
  currentUrl,
  file,
  removed,
  disabled,
  onFileChange,
  onRemovedChange,
}: {
  name: string;
  category: string;
  currentUrl: string | null;
  file: File | null;
  removed: boolean;
  disabled?: boolean;
  onFileChange: (file: File | null) => void;
  onRemovedChange: (removed: boolean) => void;
}) {
  const uid = useId();
  const inputId = `photo-${uid}`;
  const hintId = `photo-hint-${uid}`;
  const errId = `photo-err-${uid}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);

  // Object URLs are created in the change handler (not an effect) and revoked on replace and unmount.
  const latestUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (latestUrl.current) URL.revokeObjectURL(latestUrl.current);
    },
    [],
  );

  const previewUrl = file && preview?.file === file ? preview.url : null;
  const shownUrl = previewUrl ?? (removed ? null : currentUrl);
  const hasPhoto = shownUrl !== null;

  function clear() {
    if (inputRef.current) inputRef.current.value = "";
    setError(null);
    onFileChange(null);
    if (currentUrl) onRemovedChange(true);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>Photo (optional)</Label>
      <div className="flex items-start gap-4">
        <ToolImage
          name={name || "tool"}
          category={category}
          photoUrl={shownUrl}
          className="aspect-[4/3] w-28 shrink-0 rounded-md border"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={PHOTO_CONTENT_TYPES.join(",")}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${hintId} ${errId}` : hintId}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              if (!picked) return;
              const problem = checkPhotoFile(picked);
              if (problem) {
                e.target.value = "";
                setError(problem);
                return;
              }
              setError(null);
              if (latestUrl.current) URL.revokeObjectURL(latestUrl.current);
              const url = URL.createObjectURL(picked);
              latestUrl.current = url;
              setPreview({ file: picked, url });
              onRemovedChange(false);
              onFileChange(picked);
            }}
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            <ImagePlus className="mr-1 inline size-3.5 align-text-bottom" aria-hidden="true" />
            JPG, PNG or WebP, up to {MAX_MB} MB
          </p>
          {error ? (
            <p id={errId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {hasPhoto ? (
            <Button type="button" variant="outline" size="sm" onClick={clear} disabled={disabled}>
              <Trash2 aria-hidden="true" />
              Remove photo
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
