"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DashboardNav } from "./dashboard-nav";
import { UserBootstrap } from "./user-bootstrap";
import { WarmTabData } from "./warm-tab-data";

/** Signed-in shell shared by /dashboard and /admin: provisioning gate + section nav. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <UserBootstrap>
      <WarmTabData pathname={pathname} />
      <DashboardNav />
      {children}
    </UserBootstrap>
  );
}
