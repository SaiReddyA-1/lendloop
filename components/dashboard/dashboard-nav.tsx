"use client";

import { useEffect, useRef, useState } from "react";
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
  const realPathname = usePathname();
  // Optimistic active tab: the clicked href wins until the route commits, so the underline moves on click, not
  // after the next page has loaded. Cleared whenever the real pathname changes (adjust-state-during-render).
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [seenPathname, setSeenPathname] = useState(realPathname);
  if (seenPathname !== realPathname) {
    setSeenPathname(realPathname);
    setOptimistic(null);
  }
  const pathname = optimistic ?? realPathname;
  const user = useCurrentUser();
  const incoming = useQuery(api.loans.listIncoming);
  const pendingCount = incoming?.filter((l) => l.status === "pending").length ?? 0;

  const items: { href: string; label: string; exact?: boolean }[] = [...LINKS];
  if (user.role === "admin") items.push({ href: "/admin", label: "Admin" });

  // One shared underline that slides (transform and width) to the active link. Positioned by direct DOM writes
  // (no state): first placement has no transition, and a resize re-measures (tabs can wrap on narrow screens).
  const listRef = useRef<HTMLUListElement>(null);
  const barRef = useRef<HTMLLIElement>(null);
  const placedRef = useRef(false);
  useEffect(() => {
    const list = listRef.current;
    const bar = barRef.current;
    if (!list || !bar) return;
    const place = () => {
      const active = list.querySelector<HTMLElement>("a[aria-current='page']");
      if (!active) {
        bar.style.opacity = "0";
        return;
      }
      bar.style.width = `${active.offsetWidth}px`;
      bar.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop + active.offsetHeight - 2}px)`;
      bar.style.opacity = "1";
      if (!placedRef.current) {
        placedRef.current = true;
        requestAnimationFrame(() => bar.classList.add("tab-indicator"));
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(list);
    return () => ro.disconnect();
  });

  return (
    <nav aria-label="Dashboard" className="mb-8 border-b">
      <ul ref={listRef} className="relative -mb-px flex flex-wrap gap-x-1 gap-y-0">
        <li ref={barRef} role="presentation" aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 h-0.5 bg-brand opacity-0"
        />
        {items.map((item) => {
          const current = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                // Full prefetch (not just the loading shell): these routes are dynamic because of Clerk, so without
                // it every click waits on a server round trip. A full prefetch is cached for 5 minutes (ADR-050).
                prefetch
                aria-current={current ? "page" : undefined}
                onClick={() => setOptimistic(item.href)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium transition-colors",
                  current ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {item.href === "/dashboard/incoming" ? (
                  // Fixed-width slot: the badge fades in without moving the tab or the underline.
                  <span className="inline-flex min-w-6 justify-start">
                    {pendingCount > 0 ? (
                      <span className="animate-in fade-in rounded-full bg-status-warn px-1.5 py-0.5 text-xs text-status-warn-foreground duration-200">
                        {pendingCount}
                        <span className="sr-only"> pending {pendingCount === 1 ? "request" : "requests"}</span>
                      </span>
                    ) : null}
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
