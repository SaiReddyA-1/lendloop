import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-xl font-semibold tracking-tight text-primary" aria-label="LendLoop home">
          LendLoop
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-3">
          <Show when="signed-in">
            <Link href="/dashboard" className="rounded-md px-2 py-1 text-sm font-medium hover:underline">
              Dashboard
            </Link>
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <Button>Sign in</Button>
            </SignInButton>
          </Show>
        </nav>
      </div>
    </header>
  );
}
