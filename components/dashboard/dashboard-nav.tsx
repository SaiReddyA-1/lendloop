"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "./user-bootstrap";

const LINKS = [
  { href: "/dashboard", label: "Browse", exact: true },
  { href: "/dashboard/listings", label: "My listings" },
  { href: "/dashboard/requests", label: "My requests" },
  { href: "/dashboard/incoming", label: "Incoming" },
] as const;

export function DashboardNav() {
  const pathname = usePathname();
  const user = useCurrentUser();
  const incoming = useQuery(api.loans.listIncoming);
  const pending = incoming?.filter((l) => l.status === "pending").length ?? 0;

  const items: { href: string; label: string; exact?: boolean }[] = [...LINKS];
  if (user.role === "admin") items.push({ href: "/admin", label: "Admin" });

  return (
    <nav aria-label="Dashboard" className="mb-8 border-b">
      <ul className="-mb-px flex flex-wrap gap-x-1 gap-y-0">
        {items.map((item) => {
          const current = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors",
                  current
                    ? "border-brand text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {item.href === "/dashboard/incoming" && pending > 0 ? (
                  <span className="rounded-full bg-status-warn px-1.5 py-0.5 text-xs text-status-warn-foreground">
                    {pending}
                    <span className="sr-only"> pending {pending === 1 ? "request" : "requests"}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
