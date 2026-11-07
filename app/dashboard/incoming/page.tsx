import type { Metadata } from "next";
import { IncomingLoans } from "@/components/loans/incoming-loans";

export const metadata: Metadata = { title: "Incoming requests" };

export default function IncomingPage() {
  return <IncomingLoans />;
}
