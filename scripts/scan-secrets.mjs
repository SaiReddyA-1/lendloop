#!/usr/bin/env node
// Lightweight secret scan (no dependencies). Scans git-tracked files (plus untracked, non-ignored files,
// so it also catches secrets before `git add`) and applies extra rules to n8n/workflows/*.json.
// Exit 1 on findings. This is a tripwire, not a replacement for a real scanner (gitleaks) in CI.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
const files = [...new Set([...git(["ls-files"]), ...git(["ls-files", "--others", "--exclude-standard"])])];

const SKIP = /(^|\/)(package-lock\.json|\.gitattributes|scan-secrets\.mjs)$|\.(png|jpe?g|gif|ico|webp|woff2?|ttf|pdf|tsbuildinfo)$/i;
const findings = [];
const add = (file, line, rule) => findings.push(`${file}:${line}  ${rule}`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER = /^(replace|your|change|example|placeholder|xxx|<|\$\{|\{\{|=)/i;

const GENERIC_RULES = [
  [/\bsk_(live|test)_[A-Za-z0-9]{8,}/, "Clerk secret key"],
  [/\bpk_live_[A-Za-z0-9]{8,}/, "Clerk live publishable key"],
  [/\bBearer\s+[A-Za-z0-9._-]{16,}/, "bearer token"],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, "private key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
];

for (const file of files) {
  if (SKIP.test(file)) continue;
  const base = file.split("/").pop() ?? "";
  if (/^\.env($|\.)/.test(base) && !/\.example$/.test(base)) add(file, 0, ".env file is tracked");
  let text;
  try {
    if (statSync(file).size > 2_000_000) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const [re, name] of GENERIC_RULES) {
      const m = re.exec(line);
      // Docs/tests may mention the *shape* with obvious placeholders; "Bearer <token>" does not match anyway.
      if (m && !PLACEHOLDER.test(m[0].replace(/^Bearer\s+/, ""))) add(file, i + 1, name);
    }
  });
}

// Extra rules for n8n workflow exports.
for (const file of files.filter((f) => /^n8n\/workflows\/.*\.json$/.test(f))) {
  const text = readFileSync(file, "utf8");
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
  if (/"password"\s*:\s*"[^"]+/.test(text)) add(file, 0, 'password with non-empty value');
}

if (findings.length) {
  console.error("scan:secrets found possible secrets:");
  for (const f of findings) console.error("  " + f);
  process.exit(1);
}
console.log(`scan:secrets OK (${files.length} files scanned)`);
