"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/empty-state";
import { ConfirmButton } from "@/components/loans/confirm-button";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast";
import { CategoryIcon } from "@/components/category-icon";
import { categoryLabel, conditionLabel } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { ToolFormDialog } from "./tool-form-dialog";

type MyTool = FunctionReturnType<typeof api.tools.listMine>[number];

function ListingRow({ tool }: { tool: MyTool }) {
  const remove = useMutationWithToast(api.tools.remove, { success: `${tool.name} removed` });
  const removed = tool.status === "removed";

  return (
    <li
      className={cn(
        "rounded-lg border bg-card p-5 text-card-foreground",
        removed && "bg-muted/50 text-muted-foreground",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CategoryIcon category={tool.category} className="size-4" />
              {categoryLabel(tool.category)}
            </span>
            <span>{conditionLabel(tool.condition)}</span>
          </div>
          <h2 className="text-lg font-semibold leading-snug text-balance">{tool.name}</h2>
          {tool.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{tool.description}</p>
          ) : null}
          {removed ? (
            <p className="text-sm">
              {tool.removedByAdmin
                ? "A moderator removed this tool, so neighbors can no longer see or request it. Get in touch with the moderators if you think this was a mistake."
                : "You removed this tool. It is no longer visible to neighbors."}
            </p>
          ) : tool.pendingRequests > 0 ? (
            <p>
              <Link
                href="/dashboard/incoming"
                className="inline-flex min-h-6 items-center rounded-full bg-status-warn px-2.5 py-0.5 text-sm font-medium text-status-warn-foreground underline-offset-4 hover:underline"
              >
                {tool.pendingRequests} pending {tool.pendingRequests === 1 ? "request" : "requests"}{" "}
                to review
              </Link>
            </p>
          ) : null}
        </div>
        {removed ? null : (
          <div className="flex shrink-0 gap-2">
            <ToolFormDialog
              tool={tool}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil aria-hidden="true" />
                  Edit<span className="sr-only"> {tool.name}</span>
                </Button>
              }
            />
            <ConfirmButton
              label={
                <>
                  <Trash2 aria-hidden="true" />
                  Delete<span className="sr-only"> {tool.name}</span>
                </>
              }
              title={`Delete ${tool.name}?`}
              description="Neighbors will no longer see it, and any pending requests for it will be cancelled. If it is out on loan right now, mark it as returned first."
              confirmLabel="Delete tool"
              destructive
              pending={remove.pending}
              onConfirm={() => remove.run({ toolId: tool._id })}
            />
          </div>
        )}
      </div>
    </li>
  );
}

export function MyListings() {
  const tools = useQuery(api.tools.listMine);
  const listButton = (
    <Button>
      <Plus aria-hidden="true" />
      List a tool
    </Button>
  );

  return (
    <>
      <PageHeader
        title="My listings"
        description="Tools you lend out. Edit details or take one off the board any time."
        action={<ToolFormDialog trigger={listButton} />}
      />
      {tools === undefined ? (
        <ListSkeleton />
      ) : tools.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="You haven't listed anything yet"
          hint="That drill gathering dust in the garage? Someone nearby could use it this weekend."
          action={<ToolFormDialog trigger={listButton} />}
        />
      ) : (
        <ul className="space-y-3">
          {tools.map((tool) => (
            <ListingRow key={tool._id} tool={tool} />
          ))}
        </ul>
      )}
    </>
  );
}
