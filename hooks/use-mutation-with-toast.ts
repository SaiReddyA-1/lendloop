"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
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

  /** Like `run` but keeps the mutation result (e.g. a new document id). `ok: false` means a toast was shown. */
  const call = useCallback(
    async (args: FunctionArgs<M>): Promise<{ ok: true; value: FunctionReturnType<M> } | { ok: false }> => {
      setPending(true);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = await (mutate as any)(args);
        toast.success(typeof success === "function" ? success(args) : success);
        return { ok: true, value };
      } catch (e) {
        toast.error(toErrorMessage(e));
        return { ok: false };
      } finally {
        setPending(false);
      }
    },
    [mutate, success],
  );
  const run = useCallback(async (args: FunctionArgs<M>): Promise<boolean> => (await call(args)).ok, [call]);

  return { run, call, pending };
}
