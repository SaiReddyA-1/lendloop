import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminConsole } from "@/components/admin/admin-console";
import { AdminGate } from "@/components/dashboard/admin-gate";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/skeletons";

export const metadata: Metadata = { title: "Admin" };

// UX-only gate lives in proxy.ts and AdminGate; admin authorization is enforced in Convex (requireAdmin).
export default function AdminPage() {
  return (
    <AdminGate>
      <PageHeader
        title="Admin"
        description="Moderate listings, review loans, manage Trusted Lenders and watch the automation."
      />
      <Suspense fallback={<ListSkeleton />}>
        <AdminConsole />
      </Suspense>
    </AdminGate>
  );
}
