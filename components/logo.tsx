import { cn } from "@/lib/utils";

/** LendLoop wordmark with a small brand-gradient loop mark (decorative; the text is the name). */
export function Logo({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  const lg = size === "lg";
  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      <svg
        viewBox="0 0 32 32"
        aria-hidden="true"
        className={lg ? "size-10 sm:size-14" : "size-7"}
      >
        <defs>
          <linearGradient id={`loop-grad-${size}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F49267" />
            <stop offset="52%" stopColor="#E2653F" />
            <stop offset="100%" stopColor="#C0512C" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="11" fill="none" stroke={`url(#loop-grad-${size})`} strokeWidth="5" strokeDasharray="58 11" strokeLinecap="round" transform="rotate(-60 16 16)" />
        <circle cx="16" cy="16" r="3" fill="#F1643F" />
      </svg>
      <span className={cn("font-display font-normal tracking-tight", lg ? "text-6xl sm:text-7xl" : "text-2xl")}>
        LendLoop
      </span>
    </span>
  );
}
