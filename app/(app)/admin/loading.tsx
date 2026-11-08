import { ListSkeleton, PageHeaderSkeleton } from "@/components/skeletons";

/** Route-level fallback for the first visit while the segment loads: same header and data-region skeleton. */
export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="min-h-[20rem]">
        <ListSkeleton />
      </div>
    </>
  );
}
