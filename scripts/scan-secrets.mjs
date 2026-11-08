#!/usr/bin/env node
// Lightweight secret scan (no dependencies). Scans git-tracked files (plus untracked, non-ignored files,
// so it also catches secrets before `git add`) and applies extra rules to n8n/workflows/*.json.
// Exit 1 on findings, exit 2 when the scan itself cannot run (git failure) or a file cannot be read.
// This is a tripwire, not a replacement for a real scanner (gitleaks) in CI.
//
// Usage: node scripts/scan-secrets.mjs [--root <dir>]   (--root scans a directory tree without git; used by the self-test)
//
// Escape hatch: a line containing `scan-secrets:allow` is skipped (use sparingly, e.g. obvious test fixture values).
// Placeholders (replace-with-..., your-..., example, <...>, ${...}) are never findings.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 5_000_000;

// Never scanned: binaries/lockfiles (integrity hashes), this scanner and its self-test fixtures.
const SKIP = new RegExp(
  [
    "(^|/)(package-lock\\.json|pnpm-lock\\.yaml|yarn\\.lock|\\.gitattributes)$",
    "(^|/)scripts/(scan-secrets\\.mjs|scan-secrets-selftest\\.mjs)$",
    "(^|/)scripts/__fixtures__/",
    "\\.(png|jpe?g|gif|ico|webp|woff2?|ttf|pdf|tsbuildinfo|lock)$",
  ].join("|"),
  "i",
);
// Known public test vectors: RFC 4231 / similar 64-hex values are expected here.
const HEX64_ALLOW = /(^|\/)convex\/lib\/hmac\.test\.ts$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER = /^(replace|your|change|example|placeholder|xxx|<|\$\{|\{\{|=|must-equal|dummy|todo)/i;

const GENERIC_RULES = [
  [/\bsk_(live|test)_[A-Za-z0-9]{8,}/, "Clerk secret key"],
  [/\bpk_live_[A-Za-z0-9]{8,}/, "Clerk live publishable key"],
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/, "bearer token", (m) => m[0].replace(/^Bearer\s+/, "")],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, "private key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bwhsec_[A-Za-z0-9+/=_-]{8,}/, "webhook signing secret (whsec_)"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, "JWT"],
  [/\b(?:prod|dev|preview):[a-z0-9-]+\|[A-Za-z0-9=]{20,}/, "Convex deploy key"],
];
// NAME = value / NAME: value for secret-ish names with a long opaque value.
const ASSIGN_RE = /\b[A-Za-z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)\s*[=:]\s*["']?([A-Za-z0-9+/_-]{24,})/;
const HEX64_RE = /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/;

/** Scans one file's text; returns [{line, rule}]. Pure (no I/O) so the self-test can drive it. */
export function scanText(file, text) {
  const out = [];
  const isExample = /\.example$/i.test(file) || /(^|\/)\.env\.example$/i.test(file);
  const isJson = /\.json$/i.test(file);
  text.split("\n").forEach((line, i) => {
    if (line.includes("scan-secrets:allow")) return;
    for (const [re, name, pick] of GENERIC_RULES) {
      const m = re.exec(line);
      if (!m) continue;
      const value = pick ? pick(m) : m[0];
      if (!PLACEHOLDER.test(value)) out.push({ line: i + 1, rule: name });
    }
    if (!isExample) {
      const m = ASSIGN_RE.exec(line);
      if (m && !PLACEHOLDER.test(m[1] ?? "") && !UUID.test(m[1] ?? "")) {
        out.push({ line: i + 1, rule: "secret-looking assignment (SECRET/TOKEN/KEY/PASSWORD = long value)" });
      }
      if (!isJson && !HEX64_ALLOW.test(file) && HEX64_RE.test(line)) {
        out.push({ line: i + 1, rule: "64-hex string (key/hash-like) in source" });
      }
    }
  });
  return out;
}

function listFilesGit() {
  const git = (args) => {
    try {
      return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
    } catch (err) {
      console.error(`scan:secrets cannot run: 'git ${args.join(" ")}' failed (${err instanceof Error ? err.message.split("\n")[0] : err}).`);
      console.error("Run it from the repository root with git installed; the scan refuses to pass without a file list.");
      process.exit(2);
    }
  };
  return [...new Set([...git(["ls-files"]), ...git(["ls-files", "--others", "--exclude-standard"])])];
}

function listFilesFs(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return files;
}

export function scanAll(files, readRoot) {
  const findings = [];
  const unreadable = [];
  const notes = [];
  const add = (file, line, rule) => findings.push(`${file}:${line}  ${rule}`);
  let scanned = 0;

  for (const file of files) {
    if (SKIP.test(file)) continue;
    const base = file.split("/").pop() ?? "";
    if (/^\.env($|\.)/.test(base) && !/\.example$/.test(base)) add(file, 0, ".env file is tracked");
    let text;
    try {
      const full = join(readRoot, file);
      if (statSync(full).size > MAX_BYTES) {
        notes.push(`${file}: skipped, larger than ${MAX_BYTES} bytes`);
        continue;
      }
      text = readFileSync(full, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") {
        notes.push(`${file}: listed by git but missing from the working tree (deleted?), not scanned`);
      } else {
        unreadable.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }
    scanned++;
    for (const f of scanText(file, text)) add(file, f.line, f.rule);
  }

  // Extra rules for n8n workflow exports.
  for (const file of files.filter((f) => /^n8n\/workflows\/.*\.json$/.test(f))) {
    let text;
    try {
      text = readFileSync(join(readRoot, file), "utf8");
    } catch {
      continue; // already reported above (unreadable) or missing
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      add(file, 0, "invalid JSON");
      continue;
    }
    if (json.pinData && Object.keys(json.pinData).length > 0) add(file, 0, "pinData present (captured execution data)");
    const walk = (value, path) => {
      if (typeof value === "string") {
        // Long hex strings (hashes/keys) in values; node ids are UUIDs (hyphenated, never matched) and are allowed.
        if (!UUID.test(value) && /(?<![0-9a-f])[0-9a-f]{32,}(?![0-9a-f])/i.test(value) && !/^\s*(\/\/|\/\*)/.test(value)) {
          add(file, 0, `long hex string at ${path}`);
        }
        return;
      }
      if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`));
      if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          if (k === "credentials" && v && typeof v === "object") {
            for (const [type, ref] of Object.entries(v)) {
              const keys = ref && typeof ref === "object" ? Object.keys(ref) : [];
              if (keys.some((x) => !["id", "name"].includes(x))) add(file, 0, `credential ${type} has data beyond id/name`);
            }
          }
          if (k === "data" && v && typeof v === "object" && ("password" in v || "value" in v || "token" in v)) {
            add(file, 0, `credential-like data object at ${path}.${k}`);
          }
          if (/^(password|secret|token|apiKey|api_key)$/i.test(k) && typeof v === "string" && v !== "" && !PLACEHOLDER.test(v)) {
            add(file, 0, `non-empty ${k} value at ${path}`);
          }
          walk(v, `${path}.${k}`);
        }
      }
    };
    walk(json, "$");
    if (/"password"\s*:\s*"[^"]+/.test(text)) add(file, 0, "password with non-empty value");
  }
  return { findings, unreadable, notes, scanned };
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const idx = process.argv.indexOf("--root");
  const root = idx > -1 ? resolve(process.argv[idx + 1] ?? ".") : process.cwd();
  const files = idx > -1 ? listFilesFs(root) : listFilesGit();
  const { findings, unreadable, notes, scanned } = scanAll(files, root);
  for (const n of notes) console.warn(`scan:secrets note: ${n}`);
  if (unreadable.length) {
    console.error("scan:secrets could not read these files (they were NOT scanned):");
    for (const u of unreadable) console.error("  " + u);
  }
  if (findings.length) {
    console.error("scan:secrets found possible secrets:");
    for (const f of findings) console.error("  " + f);
  }
  if (unreadable.length) process.exit(2);
  if (findings.length) process.exit(1);
  console.log(`scan:secrets OK (${scanned} files scanned, ${files.length} listed)`);
}
