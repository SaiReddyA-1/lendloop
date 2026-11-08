#!/usr/bin/env node
// Bootstraps an n8n instance for LendLoop: credentials (from ENV), workflows, publish.
//   - Credentials JSON is written to a temp file (mode 0600), imported, and ALWAYS deleted.
//   - Nothing secret is written inside the repo.
// Required env:  LENDLOOP_INBOUND_TOKEN   (same value as Convex N8N_INBOUND_TOKEN)
// Optional env:  SMTP_HOST (default "mailpit"), SMTP_PORT (1025), SMTP_USER, SMTP_PASSWORD, SMTP_SECURE (false)
//                N8N_CMD    command used to run n8n (default "n8n"; local npm install: "npx n8n")
//                WORKFLOWS_DIR (default: ../workflows next to this script)
// Usage: node bootstrap.mjs   (inside the container, or locally with N8N_CMD set)
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
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

function run(args) {
  const res = spawnSync(n8n[0], [...n8n.slice(1), ...args], { stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) {
    console.error(`n8n ${args[0]} failed (exit ${res.status}).`);
    process.exit(res.status ?? 1);
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

const dir = mkdtempSync(join(tmpdir(), "lendloop-creds-"));
const credFile = join(dir, "credentials.json");
try {
  writeFileSync(credFile, JSON.stringify(credentials), { mode: 0o600 });
  console.log("Importing credentials ...");
  run(["import:credentials", `--input=${credFile}`]);
} finally {
  rmSync(dir, { recursive: true, force: true });
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
