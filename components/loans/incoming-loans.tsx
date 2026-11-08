"use client";

import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Inbox } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/skeletons";
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast";
import { formatRange } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ActionButton } from "./action-button";
import { ConfirmButton } from "./confirm-button";
import { useLoanAutomation } from "@/hooks/use-loan-automation";
import { TrustedBadge } from "@/components/trusted-badge";
import { AutomationTimeline } from "./automation-timeline";
import { StatusBadge } from "./status-badge";

export type IncomingLoan = FunctionReturnType<typeof api.loans.listIncoming>[number];

function Actions({ loan }: { loan: IncomingLoan }) {
  const approve = useMutationWithToast(api.loans.approve, {
    success: `Approved. ${loan.borrowerName} has been notified.`,
  });
  const decline = useMutationWithToast(api.loans.decline, { success: "Request declined" });
  const returned = useMutationWithToast(api.loans.markReturned, { success: "Marked as returned" });
  const busy = approve.pending || decline.pending;

  if (loan.status === "pending") {
    return (
      <div className="flex gap-2">
        <ActionButton pending={approve.pending} onClick={() => approve.run({ loanId: loan._id })}>
          Approve<span className="sr-only"> {loan.toolName} for {loan.borrowerName}</span>
        </ActionButton>
        <ActionButton
          variant="outline"
          pending={decline.pending}
          onClick={() => (busy ? undefined : decline.run({ loanId: loan._id }))}
        >
          Decline<span className="sr-only"> {loan.toolName} for {loan.borrowerName}</span>
        </ActionButton>
      </div>
    );
  }
  if (loan.status === "approved") {
    return (
      <ConfirmButton
        label={
          <>
            Mark as returned<span className="sr-only"> for {loan.toolName}</span>
          </>
        }
        title="Mark as returned?"
        description={`Confirm that ${loan.borrowerName} has brought ${loan.toolName} back. This closes the loan and can't be undone.`}
        confirmLabel="Yes, it's back"
        pending={returned.pending}
        onConfirm={() => returned.run({ loanId: loan._id })}
      />
    );
  }
  return null;
}

function IncomingRow({
  loan,
  renderFooter,
}: {
  loan: IncomingLoan;
  renderFooter?: (loan: IncomingLoan) => ReactNode;
}) {
  const overdue = loan.displayStatus === "overdue";
  return (
    <li
      className={cn(
        "rounded-lg border bg-card p-4 text-card-foreground",
        overdue && "border-destructive bg-status-bad",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{loan.toolName}</h3>
            <StatusBadge status={loan.displayStatus} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span>
              {loan.borrowerName} &middot; {formatRange(loan.startDate, loan.endDate)}
            </span>
            {loan.borrowerTrustedLender ? <TrustedBadge /> : null}
          </p>
          {overdue ? (
            <p className="text-sm font-medium text-status-bad-foreground">
              This was due back on {formatRange(loan.endDate, loan.endDate)}.
            </p>
          ) : null}
        </div>
        <Actions loan={loan} />
      </div>
      {renderFooter?.(loan)}
    </li>
  );
}

function Section({
  title,
  hint,
  loans,
  renderFooter,
}: {
  title: string;
  hint: string;
  loans: IncomingLoan[];
  renderFooter?: (loan: IncomingLoan) => ReactNode;
}) {
  if (loans.length === 0) return null;
  const id = `section-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div>
        <h2 id={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title} <span className="font-normal">({loans.length})</span>
        </h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <ul className="space-y-3">
        {loans.map((loan) => (
          <IncomingRow key={loan._id} loan={loan} renderFooter={renderFooter} />
        ))}
      </ul>
    </section>
  );
}

const rank = (l: IncomingLoan) => (l.displayStatus === "overdue" ? 0 : l.displayStatus === "active" ? 1 : 2);

/** Presentational sections (also used by the dev preview). */
export function IncomingSections({
  loans,
  renderFooter,
}: {
  loans: IncomingLoan[];
  renderFooter?: (loan: IncomingLoan) => ReactNode;
}) {
  return (
    <div className="space-y-10">
      <Section
        title="Needs your decision"
        hint="Approve or decline. Approving declines overlapping requests for you."
        loans={loans.filter((l) => l.status === "pending")}
        renderFooter={renderFooter}
      />
      <Section
        title="On loan"
        hint="Out with a neighbor or coming up. Mark it returned when it's back."
        loans={loans.filter((l) => l.status === "approved").sort((a, b) => rank(a) - rank(b))}
        renderFooter={renderFooter}
      />
      <Section
        title="History"
        hint="Finished, declined and cancelled requests."
        loans={loans.filter((l) => l.status !== "pending" && l.status !== "approved")}
        renderFooter={renderFooter}
      />
    </div>
  );
}

export function IncomingLoans() {
  const loans = useQuery(api.loans.listIncoming);
  const eventsFor = useLoanAutomation(loans);

  return (
    <>
      <PageHeader
        title="Incoming requests"
        description="Neighbors asking to borrow your tools, and the loans in progress."
      />
      {loans === undefined ? (
        <ListSkeleton />
      ) : loans.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing incoming"
          hint="When a neighbor asks to borrow one of your tools, you'll decide here."
        />
      ) : (
        <IncomingSections
          loans={loans}
          renderFooter={(loan) => (
            <AutomationTimeline events={eventsFor(loan._id)} className="mt-3 border-t pt-3" />
          )}
        />
      )}
    </>
  );
}
