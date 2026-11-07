import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Your dashboard</h1>
      <p className="text-muted-foreground">
        Your tools, borrow requests and loans will appear here.
      </p>
    </section>
  );
}
