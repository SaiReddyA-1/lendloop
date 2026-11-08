import type { ReactNode } from "react";

/**
 * Re-mounted on every route change inside the signed-in area (unlike the layout), which replays a short
 * fade and 4px rise on the content area only. The nav above it never re-renders or moves. Reduced motion
 * is handled in `.tab-enter` (globals.css). Search-param changes (admin sections, category chips) do not
 * remount a template, so they stay instant.
 */
export default function SignedInTemplate({ children }: { children: ReactNode }) {
  return <div className="tab-enter">{children}</div>;
}
