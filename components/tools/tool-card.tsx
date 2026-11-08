import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { CategoryIcon } from "@/components/category-icon";
import { TrustedBadge } from "@/components/trusted-badge";
import { categoryLabel, conditionLabel } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { RequestDialog } from "./request-dialog";
import { ToolImage } from "./tool-image";

export type BoardTool = FunctionReturnType<typeof api.tools.list>[number];

export function ToolCard({ tool }: { tool: BoardTool }) {
  const onLoan = tool.availability === "on_loan";
  return (
    <li className="interactive-card flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground">
      <ToolImage
        name={tool.name}
        category={tool.category}
        photoUrl={tool.photoUrl}
        className="aspect-[4/3] w-full"
      />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CategoryIcon category={tool.category} className="size-4" />
            {categoryLabel(tool.category)}
          </span>
          <span>{conditionLabel(tool.condition)}</span>
        </div>
        <h2 className="mt-3 text-lg font-semibold leading-snug text-balance">{tool.name}</h2>
        {tool.description ? (
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{tool.description}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span>
            <span className="text-muted-foreground">Lent by </span>
            <span className="font-medium">{tool.isMine ? "you" : tool.ownerName}</span>
          </span>
          {tool.ownerTrustedLender ? <TrustedBadge /> : null}
        </div>
        <div className="min-h-5 flex-1" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-medium",
              onLoan ? "text-status-warn-foreground" : "text-status-ok-foreground",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-full", onLoan ? "bg-status-warn-foreground" : "bg-status-ok-foreground")}
            />
            {onLoan ? "On loan" : "Available"}
          </span>
          {tool.isMine ? (
            <span className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
              Yours
            </span>
          ) : (
            <RequestDialog tool={tool} />
          )}
        </div>
      </div>
    </li>
  );
}
