"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { SearchX, Wrench } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/empty-state";
import { ToolGridSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { categoryLabel, isCategory, type CategoryValue } from "@/lib/categories";
import { CategoryFilter } from "./category-filter";
import { ToolCard } from "./tool-card";

export function ToolsBrowser() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("category");
  const category = isCategory(raw) ? raw : undefined;

  // One unfiltered subscription (server cap 200) filtered on the client: switching a chip is instant, with no
  // new query, skeleton or layout change (ADR-050). The URL stays the source of truth for the selection.
  const all = useQuery(api.tools.list, {});
  const tools = useMemo(
    () => (category && all ? all.filter((t) => t.category === category) : all),
    [all, category],
  );

  // Stagger only after a chip change (not on first paint, where the route fade already plays).
  const [staggered, setStaggered] = useState(false);

  function select(next: CategoryValue | undefined) {
    setStaggered(true);
    router.replace(next ? `${pathname}?category=${next}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <CategoryFilter value={category} onChange={select} />
      <div aria-live="polite" className="sr-only">
        {tools ? `${tools.length} ${tools.length === 1 ? "item" : "items"} shown` : ""}
      </div>
      <div className="min-h-[28rem]">
      {tools === undefined ? (
        <ToolGridSkeleton />
      ) : tools.length === 0 ? (
        category ? (
          <EmptyState
            icon={SearchX}
            title={`Nothing in ${categoryLabel(category)} yet`}
            hint="Try another category, or be the first to lend something here."
            action={
              <Button variant="outline" onClick={() => select(undefined)}>
                Show everything
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Wrench}
            title="The board is empty"
            hint="No one has listed a tool yet. Start the loop with something from your shed."
            action={
              <Button asChild>
                <Link href="/dashboard/listings">List a tool</Link>
              </Button>
            }
          />
        )
      ) : (
        <ul
          key={category ?? "all"}
          className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", staggered && "stagger-in")}
        >
          {tools.map((tool) => (
            <ToolCard key={tool._id} tool={tool} />
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}

/** Suspense fallback for the `useSearchParams` boundary: the same filter row and grid skeleton, so nothing jumps. */
export function ToolsBrowserFallback() {
  return (
    <div className="space-y-6">
      <div inert aria-hidden="true">
        <CategoryFilter value={undefined} onChange={() => undefined} />
      </div>
      <div className="min-h-[28rem]">
        <ToolGridSkeleton />
      </div>
    </div>
  );
}
