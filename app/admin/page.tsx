import type { Metadata } from "next";
import { AdminGate } from "@/components/dashboard/admin-gate";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Admin" };

// UX-only gate lives in proxy.ts and AdminGate; admin authorization is enforced in Convex (requireAdmin).
export default function AdminPage() {
  return (
    <AdminGate>
      <PageHeader title="Admin" description="Moderation and oversight tools will appear here." />
    </AdminGate>
  );
}
