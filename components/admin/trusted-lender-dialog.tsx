"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast";

// Mirrors admin.setTrustedLender: optional reason, 0..LIMITS.REASON_MAX.
const schema = z.object({
  reason: z
    .string()
    .trim()
    .max(LIMITS.REASON_MAX, `The reason can be at most ${LIMITS.REASON_MAX} characters.`),
});
type Values = z.infer<typeof schema>;

/** Grant or revoke Trusted Lender, with an optional reason for the audit log. */
export function TrustedLenderDialog({
  userId,
  userName,
  trusted,
  defaultOpen = false,
}: {
  userId: Id<"users">;
  userName: string;
  /** Current state; the action flips it. */
  trusted: boolean;
  /** Opens on mount (dev preview only). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { reason: "" } });
  const mutation = useMutationWithToast(api.admin.setTrustedLender, {
    success: trusted
      ? `${userName} is no longer a Trusted Lender`
      : `${userName} is now a Trusted Lender`,
  });
  const length = useWatch({ control, name: "reason" })?.length ?? 0;
  const id = `trusted-${userId}`;
  const verb = trusted ? "Remove Trusted Lender" : "Mark as Trusted Lender";
  const Icon = trusted ? ShieldOff : ShieldCheck;

  const onSubmit = handleSubmit(async ({ reason }) => {
    const ok = await mutation.run({
      userId,
      trusted: !trusted,
      ...(reason ? { reason } : {}),
    });
    if (ok) setOpen(false);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (mutation.pending) return;
        setOpen(o);
        if (o) reset({ reason: "" });
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Icon aria-hidden="true" />
          {verb}
          <span className="sr-only"> for {userName}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>
              {verb}: {userName}?
            </DialogTitle>
            <DialogDescription>
              {trusted
                ? "The Trusted Lender badge disappears from their listings and loans."
                : "A Trusted Lender badge appears on their listings and on loans they borrow."}{" "}
              The change is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor={`${id}-reason`}>Reason (optional)</Label>
              <span
                id={`${id}-count`}
                className={
                  length > LIMITS.REASON_MAX
                    ? "text-xs font-medium text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {length}/{LIMITS.REASON_MAX}
              </span>
            </div>
            <Textarea
              id={`${id}-reason`}
              rows={3}
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={errors.reason ? `${id}-err ${id}-count` : `${id}-count`}
              {...register("reason")}
            />
            {errors.reason ? (
              <p id={`${id}-err`} className="text-sm text-destructive">
                {errors.reason.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={mutation.pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.pending}>
              {mutation.pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
