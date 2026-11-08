import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreviewContent } from "./preview-content";

export const metadata: Metadata = { title: "Dev preview", robots: { index: false, follow: false } };

// DEV-ONLY: a gallery of the real presentational components with fixture data, used for design review.
// Not under a protected prefix in proxy.ts; it simply does not exist in production builds.
export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ dialog?: string; section?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { dialog, section } = await searchParams;
  return <PreviewContent dialog={dialog} section={section} />;
}
