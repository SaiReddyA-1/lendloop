import {
  CookingPot,
  Hammer,
  Package,
  SprayCan,
  Sprout,
  Tent,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { CATEGORIES, CONDITIONS } from "@/convex/lib/validation";

export { CATEGORIES, CONDITIONS };
export type CategoryValue = (typeof CATEGORIES)[number]["value"];
export type ConditionValue = (typeof CONDITIONS)[number]["value"];

export const CATEGORY_VALUES = CATEGORIES.map((c) => c.value) as [CategoryValue, ...CategoryValue[]];
export const CONDITION_VALUES = CONDITIONS.map((c) => c.value) as [
  ConditionValue,
  ...ConditionValue[],
];

/** One icon per category; labels come from the backend list so both sides agree. */
export const CATEGORY_ICONS: Record<CategoryValue, LucideIcon> = {
  power_tools: Zap,
  hand_tools: Hammer,
  garden: Sprout,
  kitchen: CookingPot,
  camping: Tent,
  cleaning: SprayCan,
  other: Package,
};

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? "Other";
}
export function conditionLabel(value: string): string {
  return CONDITIONS.find((c) => c.value === value)?.label ?? value;
}
export function categoryIcon(value: string): LucideIcon {
  return CATEGORY_ICONS[value as CategoryValue] ?? Wrench;
}
export function isCategory(value: string | null | undefined): value is CategoryValue {
  return CATEGORIES.some((c) => c.value === value);
}
