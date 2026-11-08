#!/usr/bin/env node
// Bootstraps an n8n instance for LendLoop: credentials (from ENV), workflows, publish.
//   - Credentials JSON is written to a temp file (mode 0600), imported, and ALWAYS deleted.
//   - Nothing secret is written inside the repo.
// Required env:  LENDLOOP_INBOUND_TOKEN   (same value as Convex N8N_INBOUND_TOKEN)
// Optional env:  SMTP_HOST (default "mailpit"), SMTP_PORT (1025), SMTP_USER, SMTP_PASSWORD, SMTP_SECURE (false)
//                N8N_BIN    path to node_modules/n8n/bin/n8n for a local npm install (spaces in paths OK)
//                N8N_CMD    simple command used to run n8n (default "n8n", e.g. inside the container)
//                WORKFLOWS_DIR (default: ../workflows next to this script)
//                LENDLOOP_BOOTSTRAP_AT_START=1  set by the hosted entrypoint (runs before the server starts; no restart hint)
//                LENDLOOP_TMP  directory for the short-lived credentials file (default: the OS temp dir)
// Usage: node bootstrap.mjs   (inside the container, or locally with N8N_CMD set)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// n8n globs the input dir: backslashes (Windows) make it find 0 files, so normalise to forward slashes.
const workflowsDir = (process.env.WORKFLOWS_DIR ?? join(here, "..", "workflows")).replaceAll("\\", "/");
// How to invoke n8n:
//   N8N_BIN  path to n8n's bin script (e.g. <dir>/node_modules/n8n/bin/n8n); run with this node, no shell.
//            Preferred for local npm installs: works with spaces in paths.
//   N8N_CMD  a simple command line such as "n8n" or "npx n8n" (split on spaces; no spaces inside paths).
const n8nBin = process.env.N8N_BIN;
const n8n = n8nBin ? [process.execPath, n8nBin] : (process.env.N8N_CMD ?? "n8n").split(" ");
const useShell = !n8nBin && process.platform === "win32"; // .cmd shims (npx) need a shell on Windows
// With a shell, quote any argument containing spaces (e.g. --input=C:/Some Dir/file.json).
const q = (a) => (useShell && /\s/.test(a) ? `"${a}"` : a);

const token = process.env.LENDLOOP_INBOUND_TOKEN;
if (!token) {
  console.error("LENDLOOP_INBOUND_TOKEN is required (same value as Convex N8N_INBOUND_TOKEN).");
  process.exit(1);
}
const smtpUser = process.env.SMTP_USER ?? "";
const smtpPassword = process.env.SMTP_PASSWORD ?? "";

/** Runs n8n; throws on failure (never exits here, so `finally` cleanup always runs). */
function run(args) {
  const res = spawnSync(q(n8n[0]), [...n8n.slice(1), ...args].map(q), { stdio: "inherit", shell: useShell });
  if (res.error) throw new Error(`n8n ${args[0]} could not start: ${res.error.message}`);
  if (res.status !== 0) {
    const err = new Error(`n8n ${args[0]} failed (exit ${res.status}).`);
    err.exitCode = res.status ?? 1;
    throw err;
  }
}

// Ids MUST match n8n/scripts/build-workflows.mjs (workflows reference credentials by id+name).
const credentials = [
  {
    id: "lendloopSmtp01",
    name: "LendLoop SMTP",
    type: "smtp",
    data: {
      host: process.env.SMTP_HOST ?? "mailpit",
      port: Number(process.env.SMTP_PORT ?? "1025"),
      secure: (process.env.SMTP_SECURE ?? "false") === "true",
      disableStartTls: true,
      ...(smtpUser ? { user: smtpUser, password: smtpPassword } : { user: "", password: "" }),
    },
  },
  {
    id: "lendloopInbound1",
    name: "LendLoop Convex inbound",
    type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Bearer ${token}` },
  },
];

function main() {
  // Temp dir for the credentials file. LENDLOOP_TMP lets machines with a full/untrusted system temp dir redirect it.
  // Permissions: mode 0o700/0o600 are enforced on POSIX only. On Windows Node ignores these modes, so the file is
  // protected solely by the ACL it inherits from the parent directory (normally the current user's profile temp dir).
  // Point LENDLOOP_TMP at a directory only your account can read, and do not run this on a shared host.
  const base = process.env.LENDLOOP_TMP ?? tmpdir();
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "lendloop-creds-"), { mode: 0o700 });
  const credFile = join(dir, "credentials.json");
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort; nothing else to do during shutdown
    }
  };
  // Safety nets so an interrupted run (Ctrl+C, kill, unexpected exit) never leaves the token on disk.
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      cleanup();
      process.exit(130);
    });
  }
  try {
    writeFileSync(credFile, JSON.stringify(credentials), { mode: 0o600 });
    console.log("Importing credentials ...");
    run(["import:credentials", `--input=${credFile}`]);
  } finally {
    cleanup();
  }

  console.log("Importing workflows ...");
  run(["import:workflow", "--separate", `--input=${workflowsDir}`]);

  console.log("Publishing workflows ...");
  for (const file of readdirSync(workflowsDir).filter((f) => f.endsWith(".json")).sort()) {
    const { id, name } = JSON.parse(readFileSync(join(workflowsDir, file), "utf8"));
    if (!id) continue;
    console.log(`  ${name}`);
    run(["publish:workflow", `--id=${id}`]);
  }
  if (process.env.LENDLOOP_BOOTSTRAP_AT_START === "1") {
    // Hosted mode (deploy/railway/n8n/entrypoint.sh): this runs before the server starts, so no restart is needed.
    console.log("Done. Workflows are published; n8n registers them as the server starts.");
  } else {
    console.log("Done. Restart n8n so published workflows (webhook/schedule) are registered:");
    console.log("  docker compose restart n8n   (or restart your local `n8n start`)");
  }
}

let exitCode = 0;
try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  exitCode = err?.exitCode ?? 1;
}
// Exit only after `finally` blocks (credentials cleanup) have run.
process.exit(exitCode);
