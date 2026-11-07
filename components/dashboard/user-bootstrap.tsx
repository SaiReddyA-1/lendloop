"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ShellSkeleton } from "@/components/skeletons";

export type CurrentUser = NonNullable<FunctionReturnType<typeof api.users.me>>;

const CurrentUserContext = createContext<CurrentUser | null>(null);

export function useCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error("useCurrentUser must be used inside <UserBootstrap>");
  return user;
}

/**
 * Provisions the Convex user row once the session is authenticated, then renders
 * children only after `users.me` returns a user (so child queries never hit
 * USER_NOT_PROVISIONED). `ensureCurrent` is idempotent; a ref prevents re-calls,
 * and a failure shows a retry button instead of looping.
 */
export function UserBootstrap({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || started.current) return;
    started.current = true;
    ensureCurrent().catch(() => {
      started.current = false;
      setFailed(true);
    });
  }, [isAuthenticated, ensureCurrent, attempt]);

  if (failed) {
    return (
      <div role="alert" className="rounded-lg border p-6">
        <h1 className="text-lg font-semibold">We couldn&apos;t set up your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Check your connection and try again.
        </p>
        <Button
          className="mt-4"
          onClick={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!isLoading && !isAuthenticated) {
    return (
      <div role="status" className="rounded-lg border p-6">
        <h1 className="text-lg font-semibold">Signing you in…</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          If this takes more than a moment, refresh the page or sign in again.
        </p>
      </div>
    );
  }

  if (isLoading || !me) return <ShellSkeleton />;

  return <CurrentUserContext.Provider value={me}>{children}</CurrentUserContext.Provider>;
}
