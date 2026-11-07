import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { ToolGridSkeleton } from "@/components/skeletons";
import { ToolsBrowser } from "@/components/tools/tools-browser";

export const metadata: Metadata = { title: "Browse tools" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Browse tools"
        description="Everything your neighbors are happy to lend. Ask, pick your days, and pick it up."
      />
      <Suspense fallback={<ToolGridSkeleton />}>
        <ToolsBrowser />
      </Suspense>
    </>
  );
}
