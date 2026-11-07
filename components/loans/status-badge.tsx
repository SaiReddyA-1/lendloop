import {
  ArrowLeftRight,
  Ban,
  CalendarCheck,
  CircleCheck,
  CircleX,
  Clock,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type DisplayStatus =
  | "pending"
  | "approved"
  | "active"
  | "overdue"
  | "declined"
  | "cancelled"
  | "returned";

const STATUS: Record<DisplayStatus, { label: string; icon: LucideIcon; className: string }> = {
  pending: { label: "Pending", icon: Clock, className: "bg-status-warn text-status-warn-foreground" },
  approved: {
    label: "Approved",
    icon: CalendarCheck,
    className: "bg-status-info text-status-info-foreground",
  },
  active: {
    label: "On loan",
    icon: ArrowLeftRight,
    className: "bg-status-info text-status-info-foreground",
  },
  overdue: {
    label: "Overdue",
    icon: TriangleAlert,
    className: "bg-status-bad text-status-bad-foreground",
  },
  declined: { label: "Declined", icon: CircleX, className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", icon: Ban, className: "bg-muted text-muted-foreground" },
  returned: {
    label: "Returned",
    icon: CircleCheck,
    className: "bg-status-ok text-status-ok-foreground",
  },
};

/** Label + icon + colour: status is never conveyed by colour alone. */
export function StatusBadge({ status, className }: { status: DisplayStatus; className?: string }) {
  const { label, icon: Icon, className: tone } = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
        tone,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
