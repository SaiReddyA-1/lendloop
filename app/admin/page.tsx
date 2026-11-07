import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin" };

// UX-only gate lives in proxy.ts; admin authorization is enforced in Convex (requireAdmin).
export default function AdminPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
      <p className="text-muted-foreground">Moderation and oversight tools will appear here.</p>
    </section>
  );
}
