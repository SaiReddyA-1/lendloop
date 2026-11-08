"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCurrentUser } from "@/components/dashboard/user-bootstrap";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AuditPanel,
  ErrorsPanel,
  ListingsPanel,
  LoansPanel,
  UsersPanel,
  type LoanFilter,
} from "./panels";

export const ADMIN_TABS = [
  { value: "listings", label: "Listings" },
  { value: "loans", label: "Loans" },
  { value: "users", label: "Users" },
  { value: "audit", label: "Audit log" },
  { value: "errors", label: "Automation errors" },
] as const;
export type AdminTab = (typeof ADMIN_TABS)[number]["value"];

function isTab(v: string | null): v is AdminTab {
  return ADMIN_TABS.some((t) => t.value === v);
}

// Only the active tab is mounted (Radix unmounts inactive content), so one query runs at a time.
function ListingsContainer() {
  const [showRemoved, setShowRemoved] = useState(false);
  const tools = useQuery(api.admin.listTools, { includeRemoved: showRemoved });
  return <ListingsPanel tools={tools} showRemoved={showRemoved} onShowRemovedChange={setShowRemoved} />;
}

function LoansContainer() {
  const [filter, setFilter] = useState<LoanFilter>("all");
  const loans = useQuery(api.admin.listLoans, filter === "all" ? {} : { status: filter });
  return <LoansPanel loans={loans} filter={filter} onFilterChange={setFilter} />;
}

function UsersContainer() {
  const me = useCurrentUser();
  const users = useQuery(api.admin.listUsers);
  return <UsersPanel users={users} currentUserId={me._id} />;
}

function AuditContainer() {
  return <AuditPanel rows={useQuery(api.admin.listAuditLog, { limit: 100 })} />;
}

function ErrorsContainer() {
  return <ErrorsPanel rows={useQuery(api.admin.listWorkflowErrors)} />;
}

/** Tabbed console; the active tab lives in `?tab=` (wrap in <Suspense>: uses useSearchParams). */
export function AdminConsole() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: AdminTab = isTab(raw) ? raw : "listings";

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => router.replace(`${pathname}?tab=${next}`, { scroll: false })}
      className="gap-6"
    >
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <TabsList aria-label="Admin sections" className="w-max">
          {ADMIN_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="px-3">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="listings">
        <ListingsContainer />
      </TabsContent>
      <TabsContent value="loans">
        <LoansContainer />
      </TabsContent>
      <TabsContent value="users">
        <UsersContainer />
      </TabsContent>
      <TabsContent value="audit">
        <AuditContainer />
      </TabsContent>
      <TabsContent value="errors">
        <ErrorsContainer />
      </TabsContent>
    </Tabs>
  );
}
