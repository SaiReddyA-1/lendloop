"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast";
import { daysInclusive, formatRange, isValidIso, todayIso } from "@/lib/dates";
import type { BoardTool } from "./tool-card";

type Booked = { startDate: string; endDate: string }[];

/** Mirrors the server rules in loans.request (dates valid, not past, <= 30 days, no overlap). */
function makeSchema(today: string, booked: Booked) {
  return z
    .object({
      startDate: z.string().min(1, "Choose a start date."),
      endDate: z.string().min(1, "Choose an end date."),
    })
    .superRefine((v, ctx) => {
      const issue = (path: "startDate" | "endDate", message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      if (!isValidIso(v.startDate)) return issue("startDate", "Choose a valid start date.");
      if (!isValidIso(v.endDate)) return issue("endDate", "Choose a valid end date.");
      if (v.startDate < today) return issue("startDate", "The start date can't be in the past.");
      if (v.endDate < v.startDate) return issue("endDate", "The end date must be on or after the start date.");
      if (daysInclusive(v.startDate, v.endDate) > LIMITS.MAX_LOAN_DAYS) {
        return issue("endDate", `Loans can last at most ${LIMITS.MAX_LOAN_DAYS} days.`);
      }
      if (booked.some((b) => v.startDate <= b.endDate && b.startDate <= v.endDate)) {
        return issue("endDate", "That tool is already booked for some of those dates.");
      }
    });
}

export function RequestDialog({ tool }: { tool: BoardTool }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery(api.tools.get, open ? { toolId: tool._id } : "skip");
  const booked = detail?.bookedRanges;
  const today = todayIso();
  const schema = useMemo(() => makeSchema(today, booked ?? []), [today, booked]);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { startDate: "", endDate: "" },
  });
  const start = useWatch({ control, name: "startDate" });

  const { run, pending } = useMutationWithToast(api.loans.request, {
    success: () => `Request sent to ${tool.ownerName}`,
  });

  const onSubmit = handleSubmit(async (values) => {
    if (await run({ toolId: tool._id, ...values })) {
      setOpen(false);
      reset();
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Request to borrow</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Borrow {tool.name}</DialogTitle>
            <DialogDescription>
              Pick the days you need it. {tool.ownerName} will approve or decline (up to{" "}
              {LIMITS.MAX_LOAN_DAYS} days).
            </DialogDescription>
          </DialogHeader>

          <div aria-live="polite">
            {booked === undefined ? (
              <p className="text-sm text-muted-foreground">Checking availability…</p>
            ) : booked.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bookings yet. Any day works.</p>
            ) : (
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="font-medium">Already booked</p>
                <ul className="mt-1 list-inside list-disc text-muted-foreground">
                  {booked.map((b) => (
                    <li key={`${b.startDate}-${b.endDate}`}>{formatRange(b.startDate, b.endDate)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`start-${tool._id}`}>Start date</Label>
              <Input
                id={`start-${tool._id}`}
                type="date"
                min={today}
                aria-invalid={errors.startDate ? true : undefined}
                aria-describedby={errors.startDate ? `start-err-${tool._id}` : undefined}
                {...register("startDate")}
              />
              {errors.startDate ? (
                <p id={`start-err-${tool._id}`} className="text-sm text-destructive">
                  {errors.startDate.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`end-${tool._id}`}>End date</Label>
              <Input
                id={`end-${tool._id}`}
                type="date"
                min={start && start > today ? start : today}
                aria-invalid={errors.endDate ? true : undefined}
                aria-describedby={errors.endDate ? `end-err-${tool._id}` : undefined}
                {...register("endDate")}
              />
              {errors.endDate ? (
                <p id={`end-err-${tool._id}`} className="text-sm text-destructive">
                  {errors.endDate.message}
                </p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
