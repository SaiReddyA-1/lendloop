#!/usr/bin/env node
// Creates 3 demo users in a Clerk TEST instance (idempotent) and seeds Convex with them.
//   CLERK_SECRET_KEY=sk_test_... SEED_PASSWORD='...' node scripts/seed-clerk-users.mjs [--print]
// --print: only print the `npx convex run` command instead of running it.
// Safety: refuses any key that does not start with `sk_test_`. The password comes from env only.
// Clerk API field names (email_address[], password, first_name, last_name, skip_password_checks,
// GET /v1/users?email_address=) are from Clerk's Backend API reference; not verified against a live
// instance in this repo's CI. Emails use the `+clerk_test` subaddress (Clerk test-mode emails).
import { spawnSync } from "node:child_process";

const key = process.env.CLERK_SECRET_KEY ?? "";
const password = process.env.SEED_PASSWORD ?? "";
if (!key.startsWith("sk_test_")) {
  console.error("Refusing to run: CLERK_SECRET_KEY must be a Clerk TEST key (sk_test_...).");
  process.exit(1);
}
if (!password) {
  console.error("SEED_PASSWORD is required (choose a strong demo password; never commit it).");
  process.exit(1);
}

const USERS = [
  { first: "Alex", last: "Rivera", email: "alex+clerk_test@example.com", role: "admin" },
  { first: "Sam", last: "Chen", email: "sam+clerk_test@example.com", role: "user" },
  { first: "Priya", last: "Patel", email: "priya+clerk_test@example.com", role: "user" },
];

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Clerk ${init.method ?? "GET"} ${path} -> ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
  return body;
};

const clerkUsers = [];
for (const u of USERS) {
  const found = await api(`/users?email_address=${encodeURIComponent(u.email)}`);
  let id = Array.isArray(found) && found[0] ? found[0].id : undefined;
  if (id) console.log(`exists  ${u.email} -> ${id}`);
  else {
    const created = await api("/users", {
      method: "POST",
      body: JSON.stringify({
        email_address: [u.email],
        first_name: u.first,
        last_name: u.last,
        password,
        skip_password_checks: true,
      }),
    });
    id = created.id;
    console.log(`created ${u.email} -> ${id}`);
  }
  clerkUsers.push({ clerkUserId: id, name: `${u.first} ${u.last}`, email: u.email, role: u.role });
}

const args = JSON.stringify({ clerkUsers });
if (process.argv.includes("--print")) {
  console.log(`npx convex run seed:run '${args}'`);
} else {
  // Run the local convex CLI via node (no shell: avoids quoting problems with the JSON arg).
  const res = spawnSync(process.execPath, ["node_modules/convex/bin/main.js", "run", "seed:run", args], {
    stdio: "inherit",
  });
  process.exit(res.status ?? 1);
}
