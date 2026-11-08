#!/usr/bin/env node
// Bootstraps an n8n instance for LendLoop: credentials (from ENV), workflows, publish.
//   - Credentials JSON is written to a temp file (mode 0600), imported, and ALWAYS deleted.
//   - Nothing secret is written inside the repo.
// Required env:  LENDLOOP_INBOUND_TOKEN   (same value as Convex N8N_INBOUND_TOKEN)
// Optional env:  SMTP_HOST (default "mailpit"), SMTP_PORT (1025), SMTP_USER, SMTP_PASSWORD, SMTP_SECURE (false)
//                N8N_CMD    command used to run n8n (default "n8n"; local npm install: "npx n8n")
//                WORKFLOWS_DIR (default: ../workflows next to this script)
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
const n8n = (process.env.N8N_CMD ?? "n8n").split(" ");

const token = process.env.LENDLOOP_INBOUND_TOKEN;
if (!token) {
  console.error("LENDLOOP_INBOUND_TOKEN is required (same value as Convex N8N_INBOUND_TOKEN).");
  process.exit(1);
}
const smtpUser = process.env.SMTP_USER ?? "";
const smtpPassword = process.env.SMTP_PASSWORD ?? "";

/** Runs n8n; throws on failure (never exits here, so `finally` cleanup always runs). */
function run(args) {
  const res = spawnSync(n8n[0], [...n8n.slice(1), ...args], { stdio: "inherit", shell: process.platform === "win32" });
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
  console.log("Done. Restart n8n so published workflows (webhook/schedule) are registered:");
  console.log("  docker compose restart n8n   (or restart your local `n8n start`)");
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
