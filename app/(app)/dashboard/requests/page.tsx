import type { Metadata } from "next";
import { MyRequests } from "@/components/loans/my-requests";

export const metadata: Metadata = { title: "My requests" };

export default function RequestsPage() {
  return <MyRequests />;
}
