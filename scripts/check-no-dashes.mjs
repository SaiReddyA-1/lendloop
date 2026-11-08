#!/usr/bin/env node
// Project rule: no em dash or en dash anywhere (literal characters or their HTML/JS escapes).
// Scans git-tracked files plus untracked, non-ignored files. Prints file:line and exits 1 on any hit.
// Exit 2 when git or a file read fails. No dependencies.
// Usage: node scripts/check-no-dashes.mjs [--selftest-only]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const BS = String.fromCharCode(0x5c);
const AMP = "&";

// Built at run time so this file itself contains none of the forbidden sequences.
const PATTERNS = [
  [EM, "em dash"],
  [EN, "en dash"],
  [AMP + "mdash;", "HTML entity for em dash"],
  [AMP + "ndash;", "HTML entity for en dash"],
  [BS + "u2014", "JS escape for em dash"],
  [BS + "u2013", "JS escape for en dash"],
  [AMP + "#8212;", "numeric entity for em dash"],
  [AMP + "#8211;", "numeric entity for en dash"],
  [AMP + "#x2014;", "hex entity for em dash"],
  [AMP + "#x2013;", "hex entity for en dash"],
];

/** Returns the descriptions of every forbidden form found in one line. */
export function findDashes(line) {
  const lower = line.toLowerCase();
  return PATTERNS.filter(([needle]) => lower.includes(needle.toLowerCase())).map(([, why]) => why);
}

const SKIP = new RegExp(
  [
    "(^|/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$",
    "(^|/)node_modules/",
    "(^|/)convex/_generated/",
    "(^|/)\.next/",
    "\.(png|jpe?g|gif|ico|webp|avif|woff2?|ttf|otf|pdf|zip|gz|tsbuildinfo|lock|mp4|webm)$",
  ].join("|"),
  "i",
);

function selfTest() {
  const must = [
    `a ${EM} b`,
    `a ${EN} b`,
    `x ${AMP}mdash; y`,
    `x ${AMP}NDASH; y`,
    `"${BS}u2014"`,
    `"${BS}u2013"`,
    `${AMP}#8212;`,
    `${AMP}#x2013;`,
  ];
  for (const s of must) {
    if (findDashes(s).length === 0) throw new Error(`self-test: missed ${JSON.stringify(s)}`);
  }
  for (const s of ["plain - hyphen", "a -- b", "Nov 10 to Nov 12", "ranges: 10-12", `${AMP}middot;`]) {
    if (findDashes(s).length !== 0) throw new Error(`self-test: false positive ${JSON.stringify(s)}`);
  }
}

selfTest();
if (process.argv.includes("--selftest-only")) {
  console.log("check-no-dashes self-test ok");
  process.exit(0);
}

let files;
try {
  const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { maxBuffer: 64 * 1024 * 1024 });
  files = out.toString("utf8").split("\0").filter(Boolean);
} catch (e) {
  console.error(`check-no-dashes: cannot list files with git (${e.message})`);
  process.exit(2);
}

let hits = 0;
for (const f of files) {
  if (SKIP.test(f)) continue;
  let buf;
  try {
    buf = readFileSync(f);
  } catch (e) {
    if (e.code === "ENOENT") continue; // deleted but still indexed
    console.error(`check-no-dashes: cannot read ${f} (${e.message})`);
    process.exit(2);
  }
  if (buf.subarray(0, 8000).includes(0)) continue; // binary
  const lines = buf.toString("utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const why of findDashes(line)) {
      hits++;
      console.error(`${f}:${i + 1}: ${why}`);
    }
  });
}

if (hits > 0) {
  console.error(`check-no-dashes: ${hits} forbidden dash occurrence(s). Use a colon, comma, period, parentheses or "to".`);
  process.exit(1);
}
console.log(`check-no-dashes: ok (${files.length} files)`);
