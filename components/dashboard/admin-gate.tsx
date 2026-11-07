"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "./user-bootstrap";

/** UX-only role gate. Convex `requireAdmin` is the real enforcement. */
export function AdminGate({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  if (user.role !== "admin") {
    return (
      <>
        <h1 className="sr-only">Admin</h1>
        <EmptyState
          icon={ShieldAlert}
          title="Admins only"
          hint="This area is for neighborhood moderators."
          action={
            <Button asChild variant="outline">
              <Link href="/dashboard">Back to the board</Link>
            </Button>
          }
        />
      </>
    );
  }
  return <>{children}</>;
}
