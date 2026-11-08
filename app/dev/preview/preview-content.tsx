"use client";

import { useState, type ReactNode } from "react";
import { Inbox, Plus, Wrench } from "lucide-react";
import {
  AuditPanel,
  ErrorsPanel,
  ListingsPanel,
  LoansPanel,
  UsersPanel,
  type LoanFilter,
} from "@/components/admin/panels";
import { RemoveToolDialog } from "@/components/admin/remove-tool-dialog";
import { TrustedLenderDialog } from "@/components/admin/trusted-lender-dialog";
import { EmptyState } from "@/components/empty-state";
import { AutomationTimeline } from "@/components/loans/automation-timeline";
import { IncomingSections } from "@/components/loans/incoming-loans";
import { RequestsList } from "@/components/loans/my-requests";
import { StatusBadge, type DisplayStatus } from "@/components/loans/status-badge";
import { ListSkeleton, ToolGridSkeleton } from "@/components/skeletons";
import { ToolCard } from "@/components/tools/tool-card";
import { ToolFormDialog } from "@/components/tools/tool-form-dialog";
import { TrustedBadge } from "@/components/trusted-badge";
import { Button } from "@/components/ui/button";
import {
  adminLoans,
  adminTools,
  adminUsers,
  auditRows,
  automationByLoan,
  boardTools,
  incomingLoans,
  ME_ID,
  myRequests,
  workflowErrors,
} from "./fixtures";

const STATUSES: DisplayStatus[] = ["pending", "approved", "active", "overdue", "declined", "cancelled", "returned"];

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`pv-${title}`} className="space-y-4">
      <h2 id={`pv-${title}`} className="border-b pb-2 text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function PreviewContent({ dialog }: { dialog?: string }) {
  const [showRemoved, setShowRemoved] = useState(true);
  const [filter, setFilter] = useState<LoanFilter>("all");
  const loansShown = filter === "all" ? adminLoans : adminLoans.filter((l) => l.status === filter);
  const toolsShown = showRemoved ? adminTools : adminTools.filter((t) => t.status === "active");
  const drill = adminTools[0]!;
  const target = adminUsers[1]!;

  return (
    <div className="space-y-14">
      <div role="note" className="rounded-lg border border-status-warn-foreground bg-status-warn px-4 py-3 text-sm font-medium text-status-warn-foreground">
        Development preview: fixture data. This page does not exist in production builds.
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">Component preview</h1>

      <Block title="Tool cards">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boardTools.map((t) => (
            <ToolCard key={t._id} tool={t} />
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <TrustedBadge />
        </div>
      </Block>

      <Block title="Status badges">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
      </Block>

      <Block title="My requests (with automation timelines)">
        <RequestsList
          loans={myRequests}
          renderFooter={(loan) => <AutomationTimeline events={automationByLoan[loan._id] ?? []} />}
        />
      </Block>

      <Block title="Incoming requests (needs decision, overdue, history)">
        <IncomingSections
          loans={incomingLoans}
          renderFooter={(loan) => (
            <AutomationTimeline events={automationByLoan[loan._id] ?? []} className="mt-3 border-t pt-3" />
          )}
        />
      </Block>

      <Block title="Timeline loading state">
        <div className="max-w-sm rounded-lg border bg-card p-4">
          <AutomationTimeline events={undefined} />
        </div>
      </Block>

      <Block title="Empty states and skeletons">
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState icon={Wrench} title="You haven't listed anything yet" hint="That drill gathering dust in the garage? Someone nearby could use it this weekend." action={<Button><Plus aria-hidden="true" />List a tool</Button>} />
          <EmptyState icon={Inbox} title="Nothing incoming" hint="When a neighbor asks to borrow one of your tools, you'll decide here." />
        </div>
        <ToolGridSkeleton count={3} />
        <ListSkeleton count={2} />
      </Block>

      <Block title="Dialogs">
        <div className="flex flex-wrap gap-3">
          <ToolFormDialog
            defaultOpen={dialog === "tool"}
            trigger={<Button><Plus aria-hidden="true" />List a tool</Button>}
          />
          <RemoveToolDialog
            toolId={drill._id}
            toolName={drill.name}
            defaultOpen={dialog === "remove"}
            trigger={<Button variant="outline">Remove listing (admin)</Button>}
          />
          <TrustedLenderDialog
            userId={target._id}
            userName={target.name}
            trusted={target.trustedLender}
            defaultOpen={dialog === "trusted"}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Add <code className="font-mono">?dialog=tool|remove|trusted</code> to open one on load.
        </p>
      </Block>

      <Block title="Admin: listings">
        <ListingsPanel tools={toolsShown} showRemoved={showRemoved} onShowRemovedChange={setShowRemoved} />
      </Block>
      <Block title="Admin: loans">
        <LoansPanel loans={loansShown} filter={filter} onFilterChange={setFilter} />
      </Block>
      <Block title="Admin: users">
        <UsersPanel users={adminUsers} currentUserId={ME_ID} />
      </Block>
      <Block title="Admin: audit log">
        <AuditPanel rows={auditRows} />
      </Block>
      <Block title="Admin: automation errors">
        <ErrorsPanel rows={workflowErrors} />
      </Block>
      <Block title="Admin: loading and empty">
        <ListingsPanel tools={undefined} showRemoved={false} onShowRemovedChange={() => undefined} />
        <AuditPanel rows={[]} />
      </Block>
    </div>
  );
}
