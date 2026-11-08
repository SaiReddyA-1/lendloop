"use client";

import type { ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { Inbox, ScrollText, ShieldAlert, Trash2, Users, Wrench } from "lucide-react";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CategoryIcon } from "@/components/category-icon";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge, type DisplayStatus } from "@/components/loans/status-badge";
import { ListSkeleton } from "@/components/skeletons";
import { TrustedBadge } from "@/components/trusted-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { categoryLabel } from "@/lib/categories";
import { formatDateTime, formatDay, formatRange } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { RemoveToolDialog } from "./remove-tool-dialog";
import { RetryEventDialog } from "./retry-event-dialog";
import { TrustedLenderDialog } from "./trusted-lender-dialog";

export type AdminTool = FunctionReturnType<typeof api.admin.listTools>[number];
export type AdminLoan = FunctionReturnType<typeof api.admin.listLoans>[number];
export type AdminUser = FunctionReturnType<typeof api.admin.listUsers>[number];
export type AuditRow = FunctionReturnType<typeof api.admin.listAuditLog>[number];
export type FailedEventRow = FunctionReturnType<typeof api.admin.listFailedAutomationEvents>[number];
export type WorkflowErrorRow = FunctionReturnType<typeof api.admin.listWorkflowErrors>[number];

/** Presentational panels: `undefined` data means loading. Containers live in admin-console.tsx. */

function Shell<T>({
  rows,
  head,
  row,
  card,
  getKey,
  label,
}: {
  rows: T[];
  head: ReactNode;
  row: (r: T) => ReactNode;
  card: (r: T) => ReactNode;
  getKey: (r: T) => string;
  label: string;
}) {
  return (
    <>
      <div className="hidden rounded-lg border bg-card md:block">
        <Table aria-label={label}>
          <TableHeader>
            <TableRow>{head}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={getKey(r)}>{row(r)}</TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul aria-label={label} className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li key={getKey(r)} className="space-y-2 rounded-lg border bg-card p-4 text-sm">
            {card(r)}
          </li>
        ))}
      </ul>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => (
  <span className="text-muted-foreground">{children}</span>
);

function asDisplayStatus(s: string, fallback: DisplayStatus): DisplayStatus {
  const known: DisplayStatus[] = ["pending", "approved", "active", "overdue", "declined", "cancelled", "returned"];
  return (known as string[]).includes(s) ? (s as DisplayStatus) : fallback;
}

// ---------------------------------------------------------------- Listings

function RemovedPill() {
  return <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">Removed</span>;
}

function RemoveAction({ tool }: { tool: AdminTool }) {
  if (tool.status === "removed") return null;
  return (
    <RemoveToolDialog
      toolId={tool._id}
      toolName={tool.name}
      trigger={
        <Button variant="outline" size="sm">
          <Trash2 aria-hidden="true" />
          Remove<span className="sr-only"> {tool.name}</span>
        </Button>
      }
    />
  );
}

export function ListingsPanel({
  tools,
  showRemoved,
  onShowRemovedChange,
}: {
  tools: AdminTool[] | undefined;
  showRemoved: boolean;
  onShowRemovedChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <label className="inline-flex min-h-6 cursor-pointer items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={showRemoved}
          onChange={(e) => onShowRemovedChange(e.target.checked)}
        />
        Show removed
      </label>
      <div aria-live="polite" className="sr-only">
        {tools ? `${tools.length} listings shown` : ""}
      </div>
      {tools === undefined ? (
        <ListSkeleton />
      ) : tools.length === 0 ? (
        <EmptyState icon={Wrench} title="No listings" hint="Nothing has been listed yet." />
      ) : (
        <Shell
          label="Listings"
          rows={tools}
          getKey={(t) => t._id}
          head={
            <>
              <TableHead>Tool</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Listed</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </>
          }
          row={(t) => (
            <>
              <TableCell className="font-medium">
                <span className="inline-flex items-center gap-2">
                  <CategoryIcon category={t.category} className="size-4 shrink-0 text-muted-foreground" />
                  {t.name}
                </span>
              </TableCell>
              <TableCell>{t.ownerName}</TableCell>
              <TableCell className="whitespace-nowrap">{formatDay(t.createdAt)}</TableCell>
              <TableCell>
                {t.status === "removed" ? (
                  <span className="inline-flex flex-col gap-0.5">
                    <RemovedPill />
                    {t.removedAt ? <Muted>{formatDay(t.removedAt)}</Muted> : null}
                  </span>
                ) : (
                  "Active"
                )}
              </TableCell>
              <TableCell className="text-right">
                <RemoveAction tool={t} />
              </TableCell>
            </>
          )}
          card={(t) => (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex items-center gap-2 font-medium">
                  <CategoryIcon category={t.category} className="size-4 shrink-0 text-muted-foreground" />
                  {t.name}
                </span>
                {t.status === "removed" ? <RemovedPill /> : <Muted>Active</Muted>}
              </div>
              <dl className="space-y-1">
                <Field label="Category">{categoryLabel(t.category)}</Field>
                <Field label="Owner">{t.ownerName}</Field>
                <Field label="Listed">{formatDay(t.createdAt)}</Field>
                {t.removedAt ? <Field label="Removed">{formatDay(t.removedAt)}</Field> : null}
              </dl>
              <RemoveAction tool={t} />
            </>
          )}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Loans

export const LOAN_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "returned", label: "Returned" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
] as const;
export type LoanFilter = (typeof LOAN_FILTERS)[number]["value"];

export function LoansPanel({
  loans,
  filter,
  onFilterChange,
}: {
  loans: AdminLoan[] | undefined;
  filter: LoanFilter;
  onFilterChange: (v: LoanFilter) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="admin-loan-status" className="text-sm font-medium">
          Status
        </label>
        <Select value={filter} onValueChange={(v) => onFilterChange(v as LoanFilter)}>
          <SelectTrigger id="admin-loan-status" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOAN_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div aria-live="polite" className="sr-only">
        {loans ? `${loans.length} loans shown` : ""}
      </div>
      {loans === undefined ? (
        <ListSkeleton />
      ) : loans.length === 0 ? (
        <EmptyState icon={Inbox} title="No loans" hint="No loans match this filter." />
      ) : (
        <Shell
          label="Loans"
          rows={loans}
          getKey={(l) => l._id}
          head={
            <>
              <TableHead>Tool</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Borrower</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requested</TableHead>
            </>
          }
          row={(l) => (
            <>
              <TableCell className="font-medium">{l.toolName}</TableCell>
              <TableCell>{l.ownerName}</TableCell>
              <TableCell>{l.borrowerName}</TableCell>
              <TableCell className="whitespace-nowrap">{formatRange(l.startDate, l.endDate)}</TableCell>
              <TableCell>
                <StatusBadge status={asDisplayStatus(l.displayStatus, l.status)} />
              </TableCell>
              <TableCell className="whitespace-nowrap">{formatDay(l.createdAt)}</TableCell>
            </>
          )}
          card={(l) => (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium">{l.toolName}</span>
                <StatusBadge status={asDisplayStatus(l.displayStatus, l.status)} />
              </div>
              <dl className="space-y-1">
                <Field label="Owner">{l.ownerName}</Field>
                <Field label="Borrower">{l.borrowerName}</Field>
                <Field label="Dates">{formatRange(l.startDate, l.endDate)}</Field>
                <Field label="Requested">{formatDay(l.createdAt)}</Field>
              </dl>
            </>
          )}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Users

function RoleBadge({ role }: { role: AdminUser["role"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
        role === "admin" ? "bg-status-info text-status-info-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {role === "admin" ? <ShieldAlert className="size-3.5" aria-hidden="true" /> : null}
      {role === "admin" ? "Admin" : "Member"}
    </span>
  );
}

function UserAction({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  if (isSelf) {
    const hint = `hint-${user._id}`;
    return (
      <div className="inline-flex flex-col items-start gap-1 md:items-end">
        <Button variant="outline" size="sm" disabled aria-describedby={hint}>
          {user.trustedLender ? "Remove Trusted Lender" : "Mark as Trusted Lender"}
          <span className="sr-only"> for {user.name}</span>
        </Button>
        <span id={hint} className="text-xs text-muted-foreground">
          You can&apos;t change your own status.
        </span>
      </div>
    );
  }
  return <TrustedLenderDialog userId={user._id} userName={user.name} trusted={user.trustedLender} />;
}

function NameCell({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  return (
    <span className="font-medium">
      {user.name}
      {isSelf ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
    </span>
  );
}

export function UsersPanel({
  users,
  currentUserId,
}: {
  users: AdminUser[] | undefined;
  currentUserId: Id<"users">;
}) {
  if (users === undefined) return <ListSkeleton />;
  if (users.length === 0) return <EmptyState icon={Users} title="No users" hint="No one has signed in yet." />;
  const trustedCell = (u: AdminUser) => (u.trustedLender ? <TrustedBadge /> : <Muted>Not trusted</Muted>);
  return (
    <Shell
      label="Users"
      rows={users}
      getKey={(u) => u._id}
      head={
        <>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Trusted</TableHead>
          <TableHead className="text-right">Active tools</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </>
      }
      row={(u) => (
        <>
          <TableCell>
            <NameCell user={u} isSelf={u._id === currentUserId} />
          </TableCell>
          <TableCell>
            <RoleBadge role={u.role} />
          </TableCell>
          <TableCell>{trustedCell(u)}</TableCell>
          <TableCell className="text-right tabular-nums">{u.activeToolCount}</TableCell>
          <TableCell className="whitespace-nowrap">{formatDay(u.createdAt)}</TableCell>
          <TableCell className="text-right">
            <UserAction user={u} isSelf={u._id === currentUserId} />
          </TableCell>
        </>
      )}
      card={(u) => (
        <>
          <div className="flex items-start justify-between gap-3">
            <NameCell user={u} isSelf={u._id === currentUserId} />
            <RoleBadge role={u.role} />
          </div>
          <dl className="space-y-1">
            <Field label="Trusted">{trustedCell(u)}</Field>
            <Field label="Active tools">{u.activeToolCount}</Field>
            <Field label="Joined">{formatDay(u.createdAt)}</Field>
          </dl>
          <UserAction user={u} isSelf={u._id === currentUserId} />
        </>
      )}
    />
  );
}

// ------------------------------------------------------------------- Audit

const AUDIT_TEXT: Record<AuditRow["action"], string> = {
  "tool.remove": "removed listing",
  "user.trusted.grant": "granted Trusted Lender",
  "user.trusted.revoke": "removed Trusted Lender",
  "user.role.promote": "made admin",
  "user.role.demote": "removed admin role",
  "automation.retry": "retried a failed notification",
};

const time = (ts: number) => (
  <time dateTime={new Date(ts).toISOString()} suppressHydrationWarning>
    {formatDateTime(ts)}
  </time>
);

export function AuditPanel({ rows }: { rows: AuditRow[] | undefined }) {
  if (rows === undefined) return <ListSkeleton />;
  if (rows.length === 0) {
    return <EmptyState icon={ScrollText} title="No activity yet" hint="Moderation actions will be recorded here." />;
  }
  const actor = (r: AuditRow) => r.actorName ?? r.actorLabel;
  return (
    <Shell
      label="Audit log"
      rows={rows}
      getKey={(r) => r._id}
      head={
        <>
          <TableHead>Time</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Reason</TableHead>
        </>
      }
      row={(r) => (
        <>
          <TableCell className="whitespace-nowrap">{time(r.createdAt)}</TableCell>
          <TableCell>{actor(r)}</TableCell>
          <TableCell>{AUDIT_TEXT[r.action]}</TableCell>
          <TableCell className="font-medium">{r.targetLabel}</TableCell>
          <TableCell className="max-w-xs whitespace-normal break-words">
            {r.reason ?? <Muted>No reason given</Muted>}
          </TableCell>
        </>
      )}
      card={(r) => (
        <>
          <p>
            <span className="font-medium">{actor(r)}</span> {AUDIT_TEXT[r.action]}{" "}
            <span className="font-medium">{r.targetLabel}</span>
          </p>
          <p className="text-muted-foreground">{time(r.createdAt)}</p>
          <p className="break-words">{r.reason ?? <Muted>No reason given</Muted>}</p>
        </>
      )}
    />
  );
}

// ------------------------------------------------------------------ Errors

export function ErrorsPanel({ rows }: { rows: WorkflowErrorRow[] | undefined }) {
  if (rows === undefined) return <ListSkeleton />;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No automation errors"
        hint="Failures reported by the n8n workflows will show up here."
      />
    );
  }
  const message = (r: WorkflowErrorRow) => (
    <span className="whitespace-pre-wrap break-words font-mono text-xs">{r.message}</span>
  );
  return (
    <Shell
      label="Automation errors"
      rows={rows}
      getKey={(r) => r._id}
      head={
        <>
          <TableHead>Time</TableHead>
          <TableHead>Workflow</TableHead>
          <TableHead>Node</TableHead>
          <TableHead>Message</TableHead>
        </>
      }
      row={(r) => (
        <>
          <TableCell className="whitespace-nowrap align-top">{time(r.createdAt)}</TableCell>
          <TableCell className="align-top">{r.workflowName}</TableCell>
          <TableCell className="align-top">{r.nodeName ?? <Muted>n/a</Muted>}</TableCell>
          <TableCell className="max-w-md whitespace-normal">{message(r)}</TableCell>
        </>
      )}
      card={(r) => (
        <>
          <p className="text-muted-foreground">{time(r.createdAt)}</p>
          <dl className="space-y-1">
            <Field label="Workflow">{r.workflowName}</Field>
            {r.nodeName ? <Field label="Node">{r.nodeName}</Field> : null}
          </dl>
          <p>{message(r)}</p>
        </>
      )}
    />
  );
}

// ----------------------------------------------------- Failed notifications

const EVENT_TEXT: Record<FailedEventRow["type"], string> = {
  request_created: "New request",
  request_approved: "Request approved",
  request_declined: "Request declined",
  request_cancelled: "Request cancelled",
  loan_returned: "Loan returned",
  overdue_reminder: "Overdue reminder",
  workflow_error: "Workflow error",
};

/** Failed outbox events with a confirmed manual retry. Renders nothing while loading or when there are none. */
export function FailedEventsPanel({ rows }: { rows: FailedEventRow[] | undefined }) {
  if (rows === undefined || rows.length === 0) return null;
  const label = (r: FailedEventRow) => `${EVENT_TEXT[r.type]} for ${r.toolName}`;
  const action = (r: FailedEventRow) =>
    r.type === "workflow_error" || r.type === "overdue_reminder" ? (
      <Muted>n/a</Muted>
    ) : (
      <RetryEventDialog eventId={r._id} label={label(r)} />
    );
  return (
    <section aria-labelledby="failed-events-heading" className="mb-8 space-y-3">
      <h2 id="failed-events-heading" className="text-lg font-semibold">
        Failed notifications
      </h2>
      <p className="text-sm text-muted-foreground">
        These notifications could not be delivered. Retrying queues delivery again.
      </p>
      <Shell
        label="Failed notifications"
        rows={rows}
        getKey={(r) => r._id}
        head={
          <>
            <TableHead>Last failure</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Error</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </>
        }
        row={(r) => (
          <>
            <TableCell className="whitespace-nowrap">{time(r.updatedAt)}</TableCell>
            <TableCell>{label(r)}</TableCell>
            <TableCell className="font-mono text-xs">{r.lastErrorCode ?? <Muted>n/a</Muted>}</TableCell>
            <TableCell>{r.attempts}</TableCell>
            <TableCell className="text-right">{action(r)}</TableCell>
          </>
        )}
        card={(r) => (
          <>
            <p className="text-muted-foreground">{time(r.updatedAt)}</p>
            <dl className="space-y-1">
              <Field label="Event">{label(r)}</Field>
              <Field label="Error">{r.lastErrorCode ?? <Muted>n/a</Muted>}</Field>
              <Field label="Attempts">{r.attempts}</Field>
            </dl>
            {action(r)}
          </>
        )}
      />
    </section>
  );
}
