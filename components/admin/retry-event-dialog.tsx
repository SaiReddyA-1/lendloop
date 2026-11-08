"use client";

import { useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast";

/** Admin re-drive of one failed automation event (confirm first; audited server-side). */
export function RetryEventDialog({
  eventId,
  label,
}: {
  eventId: Id<"automationEvents">;
  /** Human description used in the dialog and the screen-reader label, e.g. "Request approved for Cordless drill". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const mutation = useMutationWithToast(api.admin.retryAutomationEvent, {
    success: "Retry queued. Delivery will be attempted again shortly.",
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (mutation.pending) return;
        setOpen(o);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RotateCw aria-hidden="true" />
          Retry<span className="sr-only"> {label}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retry this notification?</AlertDialogTitle>
          <AlertDialogDescription>
            {label}. The attempt counter is reset and delivery is queued again. The action is recorded in the
            audit log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.pending}
            onClick={async (e) => {
              e.preventDefault(); // keep the dialog open while the mutation runs
              const ok = await mutation.run({ eventId });
              if (ok) setOpen(false);
            }}
          >
            {mutation.pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Retry
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
