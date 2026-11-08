#!/usr/bin/env node
// Self-test for scripts/scan-secrets.mjs. Fixture files are generated at run time into a temp dir
// (LENDLOOP_TMP or the OS temp dir) from string fragments, so this repo never contains secret-shaped literals.
// Each bad fixture must produce a finding for the expected rule; each good fixture must be clean.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "scan-secrets.mjs");
const j = (...parts) => parts.join("");
const hex64 = "a1b2c3d4".repeat(8);

/** [name, relative file, content, expected exit code, expected substring in stderr] */
const cases = [
  ["clean file", "src/ok.ts", 'export const x = "hello";\n', 0, ""],
  ["whsec_", "src/a.ts", j('const s = "whs', "ec_", "A1b2C3d4E5f6G7h8", '";\n'), 1, "whsec_"],
  [
    "JWT",
    "src/b.ts",
    j('const t = "ey', "JhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", '.sig";\n'),
    1,
    "JWT",
  ],
  ["Convex deploy key", "src/c.ts", j("const k = '", "prod", ":happy-animal-123|", "A".repeat(24), "';\n"), 1, "Convex deploy key"],
  ["Clerk secret key", "src/d.ts", j("const k = '", "sk_", "live_", "abcdefgh12345678", "';\n"), 1, "Clerk secret key"],
  ["SECRET assignment", "src/e.env", j("API_", "TOKEN=", "q".repeat(40), "\n"), 1, "secret-looking assignment"],
  ["PASSWORD colon form", "src/f.yml", j("db_", "PASSWORD", ': "', "Zz9".repeat(10), '"\n'), 1, "secret-looking assignment"],
  ["64-hex in source", "src/g.ts", j("const h = '", hex64, "';\n"), 1, "64-hex"],
  ["placeholder is fine", "src/h.env.example", j("API_", "TOKEN=", "replace-with-random-hex-64-chars-long-xx", "\n"), 0, ""],
  ["placeholder (non-example) is fine", "src/i.ts", j("const API_", "KEY = '", "replace-with-your-key-from-the-dashboard", "';\n"), 0, ""],
  ["allow marker", "src/j.ts", j("const API_", "KEY = '", "q".repeat(40), "'; // scan-secrets:allow fixture\n"), 0, ""],
  ["hex64 allowed in hmac test vectors", "convex/lib/hmac.test.ts", j("const v = '", hex64, "';\n"), 0, ""],
  ["hex64 ignored in JSON", "data/x.json", j('{"h": "', hex64, '"}\n'), 0, ""],
  [".env tracked", ".env.local", "FOO=bar\n", 1, ".env file is tracked"],
];

const base = process.env.LENDLOOP_TMP ?? tmpdir();
mkdirSync(base, { recursive: true });
let failed = 0;
const run = (root) => spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });

for (const [name, file, content, code, expected] of cases) {
  const root = mkdtempSync(join(base, "scan-selftest-"));
  try {
    const full = join(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    const res = run(root);
    const ok = res.status === code && (code === 0 || res.stderr.includes(expected));
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) console.log(`     exit=${res.status} (wanted ${code}) ${res.stderr.trim()}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Unreadable files must be reported, not silently skipped (POSIX only: Windows ignores chmod).
if (process.platform !== "win32" && process.getuid?.() !== 0) {
  const root = mkdtempSync(join(base, "scan-selftest-"));
  try {
    const full = join(root, "locked.ts");
    writeFileSync(full, "x");
    chmodSync(full, 0o000);
    const res = run(root);
    const ok = res.status === 2 && res.stderr.includes("could not read");
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} unreadable file is reported (exit 2)`);
    chmodSync(full, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (failed > 0) {
  console.error(`scan-secrets selftest FAILED (${failed} case(s))`);
  process.exit(1);
}
console.log("scan-secrets selftest passed");
