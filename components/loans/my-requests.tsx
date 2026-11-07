"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { HandHelping } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast";
import { CategoryIcon } from "@/components/category-icon";
import { formatRange } from "@/lib/dates";
import { ConfirmButton } from "./confirm-button";
import { StatusBadge } from "./status-badge";

export type MyRequest = FunctionReturnType<typeof api.loans.listMyRequests>[number];

function CancelRequest({ loan }: { loan: MyRequest }) {
  const cancel = useMutationWithToast(api.loans.cancel, { success: "Request cancelled" });
  if (loan.status !== "pending") return null;
  return (
    <ConfirmButton
      label={
        <>
          Cancel request<span className="sr-only"> for {loan.toolName}</span>
        </>
      }
      title="Cancel this request?"
      description={`${loan.ownerName} will be told you no longer need ${loan.toolName}. You can always send a new request.`}
      confirmLabel="Cancel request"
      destructive
      pending={cancel.pending}
      onConfirm={() => cancel.run({ loanId: loan._id })}
    />
  );
}

function ToolName({ loan }: { loan: MyRequest }) {
  return (
    <span className="inline-flex items-center gap-2 font-medium">
      <CategoryIcon category={loan.toolCategory} className="size-4 shrink-0 text-muted-foreground" />
      {loan.toolName}
    </span>
  );
}

/**
 * Table on md+, stacked cards below. `renderFooter` is the slot for the phase 6
 * automation timeline (rendered under each row/card).
 */
export function RequestsList({
  loans,
  renderFooter,
}: {
  loans: MyRequest[];
  renderFooter?: (loan: MyRequest) => ReactNode;
}) {
  return (
    <>
      <div className="hidden md:block">
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loans.map((loan) => {
                const footer = renderFooter?.(loan);
                return (
                  <TableRow key={loan._id}>
                    <TableCell>
                      <ToolName loan={loan} />
                      {footer ? <div className="mt-2">{footer}</div> : null}
                    </TableCell>
                    <TableCell>{loan.ownerName}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatRange(loan.startDate, loan.endDate)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={loan.displayStatus} />
                    </TableCell>
                    <TableCell className="text-right">
                      <CancelRequest loan={loan} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <ul className="space-y-3 md:hidden">
        {loans.map((loan) => (
          <li key={loan._id} className="space-y-3 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <ToolName loan={loan} />
              <StatusBadge status={loan.displayStatus} />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Owner</dt>
              <dd>{loan.ownerName}</dd>
              <dt className="text-muted-foreground">Dates</dt>
              <dd>{formatRange(loan.startDate, loan.endDate)}</dd>
            </dl>
            {renderFooter?.(loan)}
            {loan.status === "pending" ? (
              <div>
                <CancelRequest loan={loan} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

export function MyRequests() {
  const loans = useQuery(api.loans.listMyRequests);
  return (
    <>
      <PageHeader
        title="My requests"
        description="Everything you've asked to borrow, and where each request stands."
      />
      {loans === undefined ? (
        <ListSkeleton />
      ) : loans.length === 0 ? (
        <EmptyState
          icon={HandHelping}
          title="No requests yet"
          hint="Find something on the board and ask to borrow it. Requests show up here."
          action={
            <Button asChild>
              <Link href="/dashboard">Browse tools</Link>
            </Button>
          }
        />
      ) : (
        <RequestsList loans={loans} />
      )}
    </>
  );
}
