// The ONLY file allowed to read process.env in Convex functions. Keeping env
// access in one place makes the set of runtime secrets/config auditable.

/** Comma-separated Clerk user ids (`user_...`) that are bootstrapped as admins. */
export function adminClerkUserIdsRaw(): string {
  // eslint-disable-next-line @convex-dev/no-process-env -- centralized env access (see file header)
  return process.env.ADMIN_CLERK_USER_IDS ?? "";
}
