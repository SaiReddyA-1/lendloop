import { Show, SignInButton } from "@clerk/nextjs";
import { fetchQuery } from "convex/nextjs";
import { ArrowRight, CalendarDays, HandHelping, PackageSearch, Wrench } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { CategoryIcon } from "@/components/category-icon";
import { CATEGORIES } from "@/lib/categories";

type PublicTool = { name: string; category: string };

async function loadPublicTools(): Promise<PublicTool[] | null> {
  try {
    return await fetchQuery(api.tools.listPublic, {});
  } catch {
    return null; // Convex unreachable: render a fallback instead of crashing the page.
  }
}

const STEPS = [
  { icon: PackageSearch, title: "Find it", text: "Browse what neighbors are happy to lend." },
  { icon: CalendarDays, title: "Ask for your days", text: "Pick dates. The owner says yes or no." },
  { icon: HandHelping, title: "Borrow and return", text: "Pick it up, use it, bring it back." },
] as const;

export default async function HomePage() {
  const tools = await loadPublicTools();
  const groups = tools
    ? CATEGORIES.map((c) => ({
        ...c,
        items: tools.filter((t) => t.category === c.value),
      })).filter((g) => g.items.length > 0)
    : [];

  return (
    <>
      <section aria-labelledby="hero-title" className="max-w-3xl space-y-6 py-6 sm:py-12">
        <h1
          id="hero-title"
          className="text-5xl font-semibold tracking-tight text-balance text-primary sm:text-6xl"
        >
          LendLoop
        </h1>
        <p className="text-2xl font-medium tracking-tight text-balance sm:text-3xl">
          Borrow what you need. Lend what you don&apos;t.
        </p>
        <p className="max-w-xl text-lg text-muted-foreground text-pretty">
          A friendly board for your street. List the tools sitting idle in your shed, and borrow the
          ones you only need once.
        </p>
        <div className="pt-2">
          <Show when="signed-out">
            <SignInButton mode="modal">
              <Button size="lg" className="h-11 px-5 text-base">
                Sign in to lend or borrow
              </Button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <Button size="lg" className="h-11 px-5 text-base" asChild>
              <Link href="/dashboard">
                Go to dashboard
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </Show>
        </div>
      </section>

      <section aria-labelledby="available-tools" className="mt-12 space-y-6">
        <h2 id="available-tools" className="text-2xl font-semibold tracking-tight">
          Available in the neighborhood
        </h2>
        {tools === null ? (
          <p role="status" className="rounded-lg border border-dashed p-6 text-muted-foreground">
            We can&apos;t load the board right now. Please check back in a moment.
          </p>
        ) : tools.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No tools listed yet"
            hint="Be the first on your street to lend something. It only takes a minute."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
                <div key={group.value} className="rounded-lg border bg-card p-5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <CategoryIcon category={group.value} className="size-4 text-primary" />
                    {group.label}
                    <span className="font-normal text-muted-foreground">({group.items.length})</span>
                  </h3>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {group.items.map((item, i) => (
                      <li key={`${group.value}-${i}`}>{item.name}</li>
                    ))}
                  </ul>
                </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="how-it-works" className="mt-16 space-y-6">
        <h2 id="how-it-works" className="text-2xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4 rounded-lg border bg-card p-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <step.icon className="size-4" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-semibold">
                  <span className="text-muted-foreground">{i + 1}. </span>
                  {step.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
