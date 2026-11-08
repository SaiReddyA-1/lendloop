"use client";

import { useId, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type EventType =
  | "request_created"
  | "request_approved"
  | "request_declined"
  | "request_cancelled"
  | "loan_returned"
  | "overdue_reminder"
  | "workflow_error";
export type EventStatus = "pending" | "delivered" | "failed" | "duplicate";

export type AutomationEvent = {
  type: EventType;
  status: EventStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
};

type Sentence = (attempts: number) => string;
type Row = Record<EventStatus, Sentence>;

const plural = (n: number) => `${n} ${n === 1 ? "attempt" : "attempts"}`;

/** Standard four-state sentences for an email notification with the given subject. */
const notification = (subject: string): Row => ({
  delivered: () => `${subject} delivered`,
  pending: (a) => (a > 0 ? `${subject} pending (retrying)` : `${subject} queued`),
  failed: (a) => (a > 0 ? `${subject} failed after ${plural(a)}` : `${subject} failed`),
  duplicate: () => `${subject} skipped (already sent)`,
});

const same = (s: string): Row => ({ delivered: () => s, pending: () => s, failed: () => s, duplicate: () => s });

/** The single mapping table: event type x status -> human sentence. */
const SENTENCES: Record<EventType, Row> = {
  request_created: notification("Request notification"),
  request_approved: notification("Approval notification"),
  request_declined: notification("Decline notification"),
  request_cancelled: notification("Cancellation notification"),
  loan_returned: notification("Return notification"),
  overdue_reminder: {
    delivered: () => "Reminder sent",
    pending: () => "Reminder pending",
    failed: () => "Reminder could not be sent",
    duplicate: () => "Reminder skipped (already sent today)",
  },
  workflow_error: same("Automation error recorded"),
};

const ICONS: Record<EventStatus, { icon: LucideIcon; className: string }> = {
  delivered: { icon: CircleCheck, className: "text-status-ok-foreground" },
  pending: { icon: Clock, className: "text-status-warn-foreground" },
  failed: { icon: CircleX, className: "text-status-bad-foreground" },
  duplicate: { icon: Copy, className: "text-muted-foreground" },
};

export function describeEvent(e: Pick<AutomationEvent, "type" | "status" | "attempts">): string {
  return SENTENCES[e.type][e.status](e.attempts);
}

function EventLine({ event }: { event: AutomationEvent }) {
  const isError = event.type === "workflow_error";
  const { icon: Icon, className } = isError
    ? { icon: CircleAlert, className: "text-status-bad-foreground" }
    : ICONS[event.status];
  const when = new Date(event.updatedAt);
  return (
    <li className="flex items-start gap-1.5">
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", className)} aria-hidden="true" />
      <span>
        {describeEvent(event)} &middot;{" "}
        <time dateTime={when.toISOString()} title={formatDateTime(event.updatedAt)} suppressHydrationWarning>
          {formatDistanceToNow(when, { addSuffix: true })}
        </time>
      </span>
    </li>
  );
}

/**
 * Quiet history of automated emails for one loan. `events` undefined = still loading
 * (a one-line placeholder keeps the row height stable); empty = renders nothing.
 * Newest first; more than two events collapse behind a disclosure button.
 */
export function AutomationTimeline({
  events,
  className,
}: {
  events: AutomationEvent[] | undefined;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  if (events === undefined) {
    return (
      <div className={className} aria-hidden="true">
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
    );
  }
  if (events.length === 0) return null;

  const sorted = [...events].sort((a, b) => b.updatedAt - a.updatedAt);
  const collapsible = sorted.length > 2;
  const shown = collapsible && !expanded ? sorted.slice(0, 2) : sorted;

  return (
    <section aria-label="Automation activity" className={cn("text-xs text-muted-foreground", className)}>
      <ul id={listId} className="space-y-1">
        {shown.map((e, i) => (
          <EventLine key={`${e.type}-${e.createdAt}-${i}`} event={e} />
        ))}
      </ul>
      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((x) => !x)}
          className="mt-1 inline-flex min-h-6 items-center gap-1 rounded-sm font-medium underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
          {expanded ? "Show less" : `Show ${sorted.length - 2} earlier`}
        </button>
      ) : null}
    </section>
  );
}
