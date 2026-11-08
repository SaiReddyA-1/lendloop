#!/usr/bin/env node
// Sets Vercel PRODUCTION env vars with the value on stdin (no shell history, nothing in args).
//   CONVEX_DEPLOY_KEY                  file convex_deploy_key               (sensitive)
//   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  file clerk_publishable_key           (public by design, not sensitive)
//   CLERK_SECRET_KEY                   file clerk_secret_key                (sensitive; must be an sk_test_ key for the dev instance)
// Prints names and lengths only. Run from the linked project (`vercel link` done by the operator).
// Usage: node scripts/deploy/vercel-env.mjs [--dry-run] [--replace]
//   --replace first runs `vercel env rm NAME production --yes` so an existing value is overwritten (rotation).
// VERCEL_CMD overrides the CLI (default: "vercel" if on PATH, else "npx vercel"); only two-word forms are supported.
import { checkSecretShape, describe, fail, readSecret, run } from "./_lib.mjs";

const dry = process.argv.includes("--dry-run");
const replace = process.argv.includes("--replace");

const deployKey = readSecret("convex_deploy_key");
const publishable = readSecret("clerk_publishable_key");
const clerkSecret = readSecret("clerk_secret_key");
checkSecretShape("convex_deploy_key", deployKey, { min: 16 });
if (!/^pk_(test|live)_/.test(publishable)) fail("clerk_publishable_key must start with pk_test_ or pk_live_");
if (!/^sk_(test|live)_/.test(clerkSecret)) fail("clerk_secret_key must start with sk_test_ or sk_live_");
if (publishable.startsWith("pk_test_") !== clerkSecret.startsWith("sk_test_")) {
  fail("Clerk publishable and secret keys belong to different instance types (test vs live)");
}
if (!/^prod:/.test(deployKey)) {
  console.warn("warning: convex_deploy_key does not start with 'prod:'. A production deploy key is required for the Vercel build.");
}

const vars = [
  ["CONVEX_DEPLOY_KEY", deployKey, true],
  ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", publishable, false],
  ["CLERK_SECRET_KEY", clerkSecret, true],
];

const cli = (process.env.VERCEL_CMD ?? "npx vercel").split(" ").filter(Boolean);
const [bin, ...pre] = cli;
if (!bin) fail("VERCEL_CMD is empty");

let failures = 0;
for (const [name, value, sensitive] of vars) {
  if (dry) {
    console.log(`[dry-run] would add ${describe(name, value)} to Vercel production${sensitive ? " (sensitive)" : ""}`);
    continue;
  }
  if (replace) run(bin, [...pre, "env", "rm", name, "production", "--yes"], { capture: true });
  const args = [...pre, "env", "add", name, "production", ...(sensitive ? ["--sensitive"] : []), "--yes"];
  const res = run(bin, args, { input: value, capture: true });
  if (res.status === 0) console.log(`added ${describe(name, value)}`);
  else {
    failures++;
    console.error(`FAILED ${name}: ${(res.stderr || res.stdout).split("\n").slice(0, 3).join(" | ")}`);
    if (/already exists/i.test(res.stderr + res.stdout)) console.error("  hint: re-run with --replace to overwrite");
  }
}
if (failures) fail(`${failures} variable(s) failed`);
console.log(dry ? "Dry run complete." : "Vercel production env updated. Check with: npx vercel env ls production (names only).");
