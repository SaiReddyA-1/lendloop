"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
  onClick: () => void | Promise<unknown>;
  pending: boolean;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "default" | "sm";
};

/** Button with a pending spinner; disabled while its mutation runs. */
export function ActionButton({ children, onClick, pending, variant = "default", size = "sm" }: Props) {
  return (
    <Button variant={variant} size={size} disabled={pending} onClick={() => void onClick()}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </Button>
  );
}
