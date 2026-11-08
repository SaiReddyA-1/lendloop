import type { Metadata } from "next";
import { MyListings } from "@/components/tools/my-listings";

export const metadata: Metadata = { title: "My listings" };

export default function ListingsPage() {
  return <MyListings />;
}
