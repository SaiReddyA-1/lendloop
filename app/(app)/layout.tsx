import type { ReactNode } from "react";
import { AppShell } from "@/components/dashboard/app-shell";

/**
 * One shared signed-in layout for /dashboard and /admin (route group, no URL segment). A single layout keeps the
 * shell (UserBootstrap and the section nav) mounted when moving between the dashboard tabs and Admin; two separate
 * layouts unmounted and re-provisioned the user on every Admin switch (ADR-050).
 */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
