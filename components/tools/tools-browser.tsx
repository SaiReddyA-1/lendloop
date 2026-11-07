"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { SearchX, Wrench } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/empty-state";
import { ToolGridSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { categoryLabel, isCategory, type CategoryValue } from "@/lib/categories";
import { CategoryFilter } from "./category-filter";
import { ToolCard } from "./tool-card";

export function ToolsBrowser() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("category");
  const category = isCategory(raw) ? raw : undefined;

  const tools = useQuery(api.tools.list, category ? { category } : {});

  function select(next: CategoryValue | undefined) {
    router.replace(next ? `${pathname}?category=${next}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <CategoryFilter value={category} onChange={select} />
      <div aria-live="polite" className="sr-only">
        {tools ? `${tools.length} ${tools.length === 1 ? "item" : "items"} shown` : ""}
      </div>
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
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <ToolCard key={tool._id} tool={tool} />
          ))}
        </ul>
      )}
    </div>
  );
}
