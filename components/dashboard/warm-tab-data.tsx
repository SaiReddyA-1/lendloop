"use client";

import { useEffect } from "react";
import { useConvex, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useLoanAutomation } from "@/hooks/use-loan-automation";
import { useCurrentUser } from "./user-bootstrap";

/** How long an unmounted board query stays subscribed after the last navigation (ADR-050). */
export const WARM_FOR_MS = 5 * 60 * 1000;

/**
 * Keeps every tab's data subscribed while the shell is mounted, so a tab switch renders the cached result on the
 * first paint instead of unmounting a `useQuery` and flashing a skeleton again (ADR-050).
 * - The signed-in user's own lists are small, so they stay subscribed for the whole session.
 * - The shared board (one unfiltered query, the category chips filter it on the client) can be large: it is prewarmed with an expiry (`prewarmQuery`) and re-armed on every
 *   navigation, so it is dropped five minutes after the user last used the dashboard.
 * Renders nothing. Must sit inside <UserBootstrap> (queries need a provisioned user).
 */
export function WarmTabData({ pathname }: { pathname: string }) {
  const client = useConvex();
  const user = useCurrentUser();
  const isAdmin = user.role === "admin";

  const mine = useQuery(api.tools.listMine);
  const requests = useQuery(api.loans.listMyRequests);
  const incoming = useQuery(api.loans.listIncoming);
  // Timeline events for both loan tabs (one batched query each, same args as the tab uses).
  useLoanAutomation(requests);
  useLoanAutomation(incoming);
  void mine;

  useEffect(() => {
    client.prewarmQuery({ query: api.tools.list, args: {}, extendSubscriptionFor: WARM_FOR_MS });
    if (isAdmin) {
      client.prewarmQuery({
        query: api.admin.listTools,
        args: { includeRemoved: false },
        extendSubscriptionFor: WARM_FOR_MS,
      });
    }
  }, [client, isAdmin, pathname]);

  return null;
}
