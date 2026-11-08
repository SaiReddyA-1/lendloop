"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CategoryIllustration } from "./category-illustration";

/**
 * Tool picture slot: the owner's photo when there is one, otherwise the category illustration. The parent decides
 * the box (the `className` should set a fixed aspect ratio, e.g. `aspect-[4/3]`, so nothing shifts while the image
 * loads). A plain <img> is used on purpose (ADR-043): Convex serves the file from its own CDN-backed origin and
 * the 2 MB upload cap is enforced server-side, so next/image would only add a proxy hop and a remotePatterns entry.
 * If the photo fails to load (deleted file, offline) the illustration takes over.
 */
export function ToolImage({
  name,
  category,
  photoUrl,
  className,
  width = 400,
  height = 300,
}: {
  name: string;
  category: string;
  photoUrl: string | null;
  className?: string;
  width?: number;
  height?: number;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = photoUrl !== null && photoUrl !== failedUrl;
  return (
    <div className={cn("relative overflow-hidden bg-surface", className)}>
      <div className="card-media size-full">
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- see ADR-043
        <img
          src={photoUrl}
          alt={`Photo of ${name}`}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(photoUrl)}
          className="size-full object-cover"
        />
      ) : (
        <CategoryIllustration category={category} />
      )}
      </div>
    </div>
  );
}
