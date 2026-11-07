#!/usr/bin/env node
// Static authorization guard for Convex public functions (no dependencies).
//
// For every `export const X = query(` / `mutation(` / `action(` / `httpAction(`
// in convex/**/*.ts (excluding _generated, lib/, *.test.ts, test.setup.ts) it requires:
//   1. a contiguous `//` comment block directly above containing a line `// AUTH: ...`
//   2. unless that AUTH line starts with `public` or `identity-only`, the function
//      body must call requireUser( / requireAdmin( / requireToolOwner( / requireLoanParty(.
//
// LIMITS (this is a lint, not a proof): it uses text/paren matching, so it
//  - ignores braces/parens inside strings and comments only approximately,
//  - only sees `export const X = <builder>(` (not re-exports, aliases or wrapped builders),
//  - accepts a require* call anywhere in the block (not proving it runs first or on all paths),
//  - trusts the `public`/`identity-only` claim in the comment (reviewers must vet those).
// Internal builders (internalQuery/internalMutation/internalAction) are intentionally not checked.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(process.cwd(), "convex");
const BUILDER_RE = /^export\s+const\s+(\w+)\s*=\s*(query|mutation|action|httpAction)\s*\(/gm;
const GUARD_RE = /\b(requireUser|requireAdmin|requireToolOwner|requireLoanParty)\s*\(/;

// httpAction handlers must call authorizeInbound( (which must itself call verifyBearer( in the same file) or verifyBearer( directly.
const HTTP_GUARD_RE = /\b(authorizeInbound|verifyBearer)\s*\(/;
const AUTHORIZE_DEF_RE = /function\s+authorizeInbound\s*\([^)]*\)[^{]*\{[\s\S]*?verifyBearer\s*\(/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "_generated" || name === "lib" || name === "node_modules") continue;
      out.push(...walk(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts") && name !== "test.setup.ts") {
      out.push(full);
    }
  }
  return out;
}

/** Returns the source text from the opening paren to its matching close paren. */
function extractBlock(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return src.slice(openIdx);
}

const violations = [];
let checked = 0;

for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const usesAuthorizeInbound = /\bauthorizeInbound\s*\(/.test(src);
  if (usesAuthorizeInbound && !AUTHORIZE_DEF_RE.test(src)) {
    violations.push(`${relative(process.cwd(), file)}: authorizeInbound is used but not defined with a verifyBearer( call`);
  }
  for (const m of src.matchAll(BUILDER_RE)) {
    checked++;
    const name = m[1];
    const lineNo = src.slice(0, m.index).split("\n").length; // 1-based
    const where = `${relative(process.cwd(), file)}:${lineNo} ${name}`;

    // Collect contiguous comment lines directly above.
    const comments = [];
    for (let i = lineNo - 2; i >= 0 && lines[i].trim().startsWith("//"); i--) comments.push(lines[i].trim());
    const authLine = comments.find((c) => /^\/\/\s*AUTH:/.test(c));
    if (!authLine) {
      violations.push(`${where}: missing '// AUTH:' comment immediately above the export`);
      continue;
    }
    const decision = authLine.replace(/^\/\/\s*AUTH:\s*/, "");
    if (/^(public|identity-only)\b/i.test(decision)) continue;

    const block = extractBlock(src, m.index + m[0].length - 1);
    if (m[2] === "httpAction") {
      // HTTP actions authenticate with a bearer token, not a Clerk identity.
      if (!HTTP_GUARD_RE.test(block)) {
        violations.push(`${where}: AUTH says '${decision}' but no authorizeInbound( / verifyBearer( call found in the httpAction`);
      }
      continue;
    }
    if (!GUARD_RE.test(block)) {
      violations.push(`${where}: AUTH says '${decision}' but no requireUser/requireAdmin/requireToolOwner/requireLoanParty call found`);
    }
  }
}

if (violations.length > 0) {
  console.error(`authz check FAILED (${violations.length} violation(s)):`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`authz check passed (${checked} public function(s) checked)`);
