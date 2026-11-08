import type { ReactNode } from "react";

type Props = { title: string; description?: string; action?: ReactNode };

/** The single h1 of each page: one display size, optional one-line description and action. */
export function PageHeader({ title, description, action }: Props) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="font-display text-4xl font-normal tracking-tight text-balance">{title}</h1>
        {description ? (
          <p className="max-w-prose text-muted-foreground text-pretty">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
