"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Props = {
  /** Visible trigger button content. */
  label: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  /** Resolves true on success (dialog closes), false to keep it open. */
  onConfirm: () => Promise<boolean>;
  pending: boolean;
  destructive?: boolean;
  size?: "default" | "sm";
  triggerVariant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
};

/** Button that asks for confirmation before running an irreversible action. */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
  destructive,
  size = "sm",
  triggerVariant = "outline",
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <AlertDialogTrigger asChild>
        <Button variant={triggerVariant} size={size}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={async () => {
              if (await onConfirm()) setOpen(false);
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
