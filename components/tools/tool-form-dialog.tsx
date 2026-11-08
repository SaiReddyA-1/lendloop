"use client";

import { useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast";
import { useToolPhotoSync } from "@/hooks/use-tool-photo-sync";
import {
  CATEGORIES,
  CATEGORY_VALUES,
  CONDITIONS,
  CONDITION_VALUES,
  type CategoryValue,
  type ConditionValue,
} from "@/lib/categories";
import { PhotoField } from "./photo-field";

// Client limits come from the same constants the server enforces.
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(LIMITS.TOOL_NAME_MIN, `Name must be at least ${LIMITS.TOOL_NAME_MIN} characters.`)
    .max(LIMITS.TOOL_NAME_MAX, `Name can be at most ${LIMITS.TOOL_NAME_MAX} characters.`),
  category: z.enum(CATEGORY_VALUES, "Choose a category."),
  condition: z.enum(CONDITION_VALUES, "Choose a condition."),
  description: z
    .string()
    .max(LIMITS.DESCRIPTION_MAX, `Description can be at most ${LIMITS.DESCRIPTION_MAX} characters.`),
});
type FormValues = z.infer<typeof schema>;

export type EditableTool = {
  _id: Id<"tools">;
  name: string;
  category: CategoryValue;
  condition: ConditionValue;
  description: string;
  photoUrl?: string | null;
};

/** Create (no `tool`) or edit (prefilled) dialog; `trigger` is the opening button. */
export function ToolFormDialog({
  tool,
  trigger,
  defaultOpen = false,
}: {
  tool?: EditableTool;
  trigger: ReactNode;
  /** Opens on mount (dev preview only). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const editing = tool !== undefined;
  const idBase = tool?._id ?? "new";

  const initial: Partial<FormValues> = tool
    ? {
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
      }
    : { name: "", description: "" };

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: initial });

  const create = useMutationWithToast(api.tools.create, { success: "Tool listed. Thanks for lending!" });
  const update = useMutationWithToast(api.tools.update, { success: "Changes saved" });
  const photos = useToolPhotoSync();
  const pending = create.pending || update.pending || photos.pending;
  const length = useWatch({ control, name: "description" })?.length ?? 0;
  const watchedName = useWatch({ control, name: "name" }) ?? "";
  const watchedCategory = useWatch({ control, name: "category" }) ?? "other";

  const onSubmit = handleSubmit(async (values) => {
    let toolId: Id<"tools"> | null = null;
    if (tool) {
      if (await update.run({ toolId: tool._id, ...values })) toolId = tool._id;
    } else {
      const created = await create.call(values);
      if (created.ok) toolId = created.value;
    }
    if (toolId === null) return;
    // The tool is saved at this point; a photo problem is toasted and can be retried via Edit.
    await photos.sync(toolId, { file: photoFile, remove: photoRemoved });
    setOpen(false);
    if (!tool) reset({ name: "", description: "" });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          reset(initial);
          setPhotoFile(null);
          setPhotoRemoved(false);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit tool" : "List a tool"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the details your neighbors see."
                : "Tell neighbors what you can lend. You approve every request."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`name-${idBase}`}>Name</Label>
            <Input
              id={`name-${idBase}`}
              autoComplete="off"
              maxLength={LIMITS.TOOL_NAME_MAX + 20}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `name-err-${idBase}` : undefined}
              {...register("name")}
            />
            {errors.name ? (
              <p id={`name-err-${idBase}`} className="text-sm text-destructive">
                {errors.name.message}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`category-${idBase}`}>Category</Label>
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id={`category-${idBase}`}
                      className="w-full"
                      aria-invalid={errors.category ? true : undefined}
                      aria-describedby={errors.category ? `category-err-${idBase}` : undefined}
                    >
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.category ? (
                <p id={`category-err-${idBase}`} className="text-sm text-destructive">
                  {errors.category.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`condition-${idBase}`}>Condition</Label>
              <Controller
                control={control}
                name="condition"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id={`condition-${idBase}`}
                      className="w-full"
                      aria-invalid={errors.condition ? true : undefined}
                      aria-describedby={errors.condition ? `condition-err-${idBase}` : undefined}
                    >
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.condition ? (
                <p id={`condition-err-${idBase}`} className="text-sm text-destructive">
                  {errors.condition.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor={`desc-${idBase}`}>Description (optional)</Label>
              <span
                id={`desc-count-${idBase}`}
                className={
                  length > LIMITS.DESCRIPTION_MAX
                    ? "text-xs font-medium text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {length}/{LIMITS.DESCRIPTION_MAX}
              </span>
            </div>
            <Textarea
              id={`desc-${idBase}`}
              rows={4}
              placeholder="Size, what it's good for, anything to know before borrowing."
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={
                errors.description
                  ? `desc-err-${idBase} desc-count-${idBase}`
                  : `desc-count-${idBase}`
              }
              {...register("description")}
            />
            {errors.description ? (
              <p id={`desc-err-${idBase}`} className="text-sm text-destructive">
                {errors.description.message}
              </p>
            ) : null}
          </div>

          <PhotoField
            name={watchedName}
            category={watchedCategory}
            currentUrl={tool?.photoUrl ?? null}
            file={photoFile}
            removed={photoRemoved}
            disabled={pending}
            onFileChange={setPhotoFile}
            onRemovedChange={setPhotoRemoved}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {editing ? "Save changes" : "List tool"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
