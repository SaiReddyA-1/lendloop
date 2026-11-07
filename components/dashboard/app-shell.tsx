"use client";

import type { ReactNode } from "react";
import { DashboardNav } from "./dashboard-nav";
import { UserBootstrap } from "./user-bootstrap";

/** Signed-in shell shared by /dashboard and /admin: provisioning gate + section nav. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <UserBootstrap>
      <DashboardNav />
      {children}
    </UserBootstrap>
  );
}
