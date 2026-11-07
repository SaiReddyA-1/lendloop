"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { toast } from "sonner";
import { toErrorMessage } from "@/lib/errors";

type Options<M extends FunctionReference<"mutation">> = {
  /** Toast text on success; may depend on the args. */
  success: string | ((args: FunctionArgs<M>) => string);
};

/**
 * Wraps a Convex mutation with a pending flag (disable button + spinner) and
 * success/error toasts. `run` resolves to true on success, false on failure,
 * and never throws, so callers can close dialogs only on success.
 */
export function useMutationWithToast<M extends FunctionReference<"mutation">>(
  ref: M,
  options: Options<M>,
) {
  const mutate = useMutation(ref);
  const [pending, setPending] = useState(false);
  const { success } = options;

  const run = useCallback(
    async (args: FunctionArgs<M>): Promise<boolean> => {
      setPending(true);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (mutate as any)(args);
        toast.success(typeof success === "function" ? success(args) : success);
        return true;
      } catch (e) {
        toast.error(toErrorMessage(e));
        return false;
      } finally {
        setPending(false);
      }
    },
    [mutate, success],
  );

  return { run, pending };
}
