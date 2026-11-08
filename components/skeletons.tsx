import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

function Loading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

/** Mirrors PageHeader (h1 text-4xl, one-line description, mb-8) for route-level loading states. */
export function PageHeaderSkeleton() {
  return (
    <div aria-hidden="true" className="mb-8 space-y-2">
      <Skeleton className="h-10 w-64 max-w-full" />
      <Skeleton className="h-6 w-full max-w-prose" />
    </div>
  );
}

export function ToolGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Loading className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        // Mirrors ToolCard: 4:3 image, p-5 body (meta, title, 3-line blurb, owner), footer row.
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-lg border bg-card"
          aria-hidden="true"
        >
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="p-5">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="mt-3 h-7 w-3/4" />
            <Skeleton className="mt-2 h-[60px] w-full" />
            <Skeleton className="mt-4 h-5 w-2/5" />
            <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
        </div>
      ))}
    </Loading>
  );
}

export function ListSkeleton({
  count = 4,
  variant = "rows",
}: {
  count?: number;
  /** "listings" mirrors a My listings row (p-5, 4:3 thumbnail); "rows" mirrors request and loan rows. */
  variant?: "rows" | "listings";
}) {
  if (variant === "listings") {
    return (
      <Loading className="space-y-3">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-4 rounded-lg border bg-card p-5 sm:flex-row sm:items-start"
            aria-hidden="true"
          >
            <Skeleton className="aspect-[4/3] w-full shrink-0 sm:w-32" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-8 w-24 shrink-0" />
          </div>
        ))}
      </Loading>
    );
  }
  return (
    <Loading className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4"
          aria-hidden="true"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </Loading>
  );
}

export function ShellSkeleton() {
  return (
    <Loading>
      <Skeleton className="mb-8 h-9 w-64" />
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    </Loading>
  );
}
