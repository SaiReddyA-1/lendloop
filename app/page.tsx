import { Show, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <>
      <section aria-labelledby="hero-title" className="max-w-2xl space-y-6 py-8">
        <h1 id="hero-title" className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          LendLoop
        </h1>
        <p className="text-xl text-muted-foreground text-pretty">
          Borrow what you need. Lend what you don&apos;t.
        </p>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <Button size="lg">Sign in to lend or borrow</Button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Button size="lg" asChild>
            <Link href="/dashboard">Go to your dashboard</Link>
          </Button>
        </Show>
      </section>

      <section aria-labelledby="available-tools" className="mt-12 space-y-4">
        <h2 id="available-tools" className="text-2xl font-semibold tracking-tight">
          Available tools
        </h2>
        <p className="rounded-lg border border-dashed p-6 text-muted-foreground">
          Tools your neighbors are lending will show up here soon.
        </p>
      </section>
    </>
  );
}
