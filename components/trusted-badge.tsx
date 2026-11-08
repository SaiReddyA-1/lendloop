import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** The one "Trusted Lender" marker: icon + text + colour, never colour alone. */
export function TrustedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-status-ok px-2 py-0.5 text-xs font-medium text-status-ok-foreground",
        className,
      )}
    >
      <ShieldCheck className="size-3.5" aria-hidden="true" />
      Trusted Lender
    </span>
  );
}
