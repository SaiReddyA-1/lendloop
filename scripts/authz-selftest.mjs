#!/usr/bin/env node
// Self-test for scripts/check-authz.mjs: every bad fixture must FAIL (with the expected message), the good
// fixture must PASS. Fixtures live in scripts/__fixtures__/authz/<case>/convex (outside convex/, so Convex,
// Vitest, ESLint and tsc never see them).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "check-authz.mjs");
const fixtures = join(here, "__fixtures__", "authz");

/** [fixture dir, should pass, substring expected in stderr for failures] */
const cases = [
  ["good", true, ""],
  ["bad-unguarded", false, "no requireUser"],
  ["bad-guard-in-comment", false, "no requireUser"],
  ["bad-guard-in-string", false, "no requireUser"],
  ["bad-lib-public-mutation", false, "uses the public builder 'mutation'"],
  ["bad-unallowlisted-public", false, "not in PUBLIC_ALLOWLIST"],
  ["bad-missing-auth", false, "missing '// AUTH:'"],
  ["bad-default-export", false, "default"],
  ["bad-named-export", false, "hidden"],
  ["bad-aliased-import", false, "missing '// AUTH:'"],
  ["bad-reexport", false, "re-export"],
  ["bad-wrapped", false, "missing '// AUTH:'"],
  ["bad-fake-auth-comment", false, "missing '// AUTH:'"],
  ["bad-http-unguarded", false, "no authorizeInbound"],
];

let failed = 0;
for (const [name, shouldPass, expected] of cases) {
  const res = spawnSync(process.execPath, [script, "--root", join(fixtures, name, "convex")], { encoding: "utf8" });
  const passed = res.status === 0;
  const messageOk = shouldPass || res.stderr.includes(expected);
  const ok = passed === shouldPass && messageOk;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name} (${shouldPass ? "must pass" : "must fail"})`);
  if (!ok) console.log(`     exit=${res.status}\n     ${(res.stderr || res.stdout).trim().replaceAll("\n", "\n     ")}`);
}
if (failed > 0) {
  console.error(`authz selftest FAILED (${failed} case(s))`);
  process.exit(1);
}
console.log(`authz selftest passed (${cases.length} fixtures)`);
