"use client";

import { useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
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

// Mirrors admin.removeTool: reason 3..LIMITS.REASON_MAX after trimming.
const REASON_MIN = 3;
const schema = z.object({
  reason: z
    .string()
    .trim()
    .min(REASON_MIN, `Give a reason of at least ${REASON_MIN} characters.`)
    .max(LIMITS.REASON_MAX, `The reason can be at most ${LIMITS.REASON_MAX} characters.`),
});
type Values = z.infer<typeof schema>;

export function RemoveToolDialog({
  toolId,
  toolName,
  trigger,
  defaultOpen = false,
}: {
  toolId: Id<"tools">;
  toolName: string;
  trigger: ReactNode;
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
  const remove = useMutationWithToast(api.admin.removeTool, {
    success: `${toolName} removed. Pending requests were cancelled.`,
  });
  const length = useWatch({ control, name: "reason" })?.length ?? 0;
  const id = `remove-${toolId}`;

  const onSubmit = handleSubmit(async ({ reason }) => {
    if (await remove.run({ toolId, reason })) setOpen(false);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (remove.pending) return;
        setOpen(o);
        if (o) reset({ reason: "" });
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Remove {toolName}?</DialogTitle>
            <DialogDescription>
              The listing disappears from the board. Pending requests for it are cancelled and the
              borrowers are notified. Approved loans are kept, because the borrower may already have
              the tool.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor={`${id}-reason`}>Reason (recorded in the audit log)</Label>
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={remove.pending}>
              Keep listing
            </Button>
            <Button type="submit" variant="destructive" disabled={remove.pending}>
              {remove.pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Remove listing
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
