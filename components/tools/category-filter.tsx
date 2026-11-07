"use client";

import { CategoryIcon } from "@/components/category-icon";
import { CATEGORIES, type CategoryValue } from "@/lib/categories";
import { cn } from "@/lib/utils";

type Props = {
  value: CategoryValue | undefined;
  onChange: (value: CategoryValue | undefined) => void;
};

const OPTIONS: { value: CategoryValue | undefined; label: string; icon: string }[] = [
  { value: undefined, label: "All", icon: "other" },
  ...CATEGORIES.map((c) => ({ value: c.value as CategoryValue, label: c.label, icon: c.value })),
];

/** Wrapping group of toggle buttons (no horizontal scroll at 360px); aria-pressed marks the choice. */
export function CategoryFilter({ value, onChange }: Props) {
  return (
    <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
      {OPTIONS.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.label}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
              pressed
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-foreground hover:bg-accent",
            )}
          >
            {option.value === undefined ? null : (
              <CategoryIcon category={option.icon} className="size-4" />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
