import { Wrench } from "lucide-react";
import { CATEGORY_ICONS, type CategoryValue } from "@/lib/categories";

/** Decorative category icon (the label is always rendered next to it). */
export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = CATEGORY_ICONS[category as CategoryValue] ?? Wrench;
  return <Icon className={className} aria-hidden="true" />;
}
