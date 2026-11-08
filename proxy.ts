import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Request interception (Next.js 16 `proxy.ts`, formerly middleware.ts).
 *
 * Route protection here is a UX convenience (redirect unauthenticated users to
 * sign-in). It is NOT the security boundary: every Convex function performs its
 * own authentication/authorization (see README.md and docs/DECISIONS.md).
 */
const PROTECTED_PREFIXES = ["/dashboard", "/admin"];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default clerkMiddleware(
  async (auth, request) => {
    if (isProtectedPath(request.nextUrl.pathname)) {
      await auth.protect();
    }
  },
  {
    // Clerk merges its own required origins into these directives.
    contentSecurityPolicy: {
      directives: {
        "connect-src": [
          "https://*.convex.cloud",
          "wss://*.convex.cloud",
          "https://*.convex.site",
          // Local Convex dev deployment (anonymous/local backend).
          ...(process.env.NODE_ENV !== "production" ? ["http://127.0.0.1:*", "ws://127.0.0.1:*"] : []),
        ],
        // Tool photos are served from the Convex storage origin; blob: is the local preview of a chosen file.
        "img-src": [
          "'self'",
          "data:",
          "blob:",
          "https://*.convex.cloud",
          ...(process.env.NODE_ENV !== "production" ? ["http://127.0.0.1:*"] : []),
        ],
        "frame-ancestors": ["'none'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
      },
    },
  },
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
