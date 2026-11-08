import type { NextConfig } from "next";

// Static security headers for every route. The Content-Security-Policy is
// injected per-request (with a nonce) by Clerk middleware in proxy.ts.
const securityHeaders = [
  // No `preload`: HSTS preload is effectively irreversible and covers every subdomain, so it is a deliberate
  // per-domain opt-in (submit at hstspreload.org and add the token) once the production domain is final.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false, // hides the dev overlay badge (e.g. in design-review screenshots)
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
