#!/usr/bin/env node
// Static authorization guard for Convex public functions (no dependencies).
//
// Usage: node scripts/check-authz.mjs [--root <convex dir>]   (default: ./convex)
//
// A "public builder" is `query` / `mutation` / `action` / `httpAction` (and the `*Generic` variants from
// convex/server), under whatever local name they are imported (aliases and `import * as s` are followed).
// Rules (all enforced on source with COMMENTS and STRING/TEMPLATE LITERALS BLANKED OUT, so a guard or an
// export that only exists in a comment/string never counts):
//   1. Every PUBLIC EXPORT must have a contiguous `//` comment block directly above containing `// AUTH: ...`.
//      Public exports are: `export const X(: Type)? = builder(...)` (also when the builder is wrapped, e.g.
//      `export const X = wrap(query({...}))`), `export default <builder call | builder const>`, and
//      `export { X [as Y] }` of a const initialised with a builder (the AUTH comment goes above that const).
//      `export ... from` / `export *` re-exports are rejected in convex/ modules (they would publish a function
//      under a second path without annotation).
//   2. Unless the AUTH decision starts with `public` / `identity-only`, the body must call requireUser( /
//      requireAdmin( / requireToolOwner( / requireLoanParty( (httpAction: authorizeInbound( / verifyBearer( ).
//   3. `public` / `identity-only` is only accepted for the explicit allowlist below. Anything else claiming
//      public access fails: adding a new public endpoint is a conscious change to THIS file (review it).
//   4. convex/lib/**, *.test.ts and test.setup.ts must not use ANY public builder (helpers must stay internal
//      or plain functions, otherwise they would silently become client-callable).
//   5. authorizeInbound must be defined with a verifyBearer( call in the same file.
// Internal builders (internalQuery/internalMutation/internalAction) are intentionally not checked.
//
// LIMITS (this is a lint, not a proof): text-based tokenizer (no full TS parse); it accepts a require* call
// anywhere in the body (not proving it runs first or on every path); it cannot see builders created via
// third-party wrappers that do not mention a builder name; `// AUTH:` text is a claim a reviewer must vet.
// `npm run authz:selftest` proves the lint rejects the known bypasses (fixtures in scripts/__fixtures__/authz).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** `file#name` pairs (file relative to the convex dir, forward slashes) allowed to claim `public` / `identity-only`. */
export const PUBLIC_ALLOWLIST = new Set([
  "tools.ts#listPublic", // landing-page teaser: { name, category } of active tools only
  "users.ts#me", // returns null when signed out, otherwise only the caller's own projected fields
  "users.ts#ensureCurrent", // self-provisioning from verified JWT claims, no args
  "http.ts#methodNotAllowed", // bare 405 handler, no data, no side effects
]);

const PUBLIC_BUILDERS = ["query", "mutation", "action", "httpAction"];
const GENERIC_BUILDERS = {
  queryGeneric: "query",
  mutationGeneric: "mutation",
  actionGeneric: "action",
  httpActionGeneric: "httpAction",
};
const GUARD_RE = /\b(requireUser|requireAdmin|requireToolOwner|requireLoanParty)\s*\(/;
const HTTP_GUARD_RE = /\b(authorizeInbound|verifyBearer)\s*\(/;
const AUTHORIZE_DEF_RE = /function\s+authorizeInbound\s*\([^)]*\)[^{]*\{[\s\S]*?verifyBearer\s*\(/;

/** Replaces comment bodies and string/template/regex literal contents with spaces (offsets and newlines kept). */
export function blankNoise(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  let i = 0;
  let prevSig = ""; // previous significant (non-space, non-comment) char, to tell regex from division
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (ch === "/" && next === "*") {
      let j = src.indexOf("*/", i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j);
      i = j;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      blank(i + 1, Math.min(j, n));
      i = j + 1;
      prevSig = ch;
    } else if (ch === "`") {
      // Template literal: blank everything including ${...} (nesting-aware).
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === "\\") j += 2;
        else if (depth === 0 && src[j] === "`") break;
        else if (src[j] === "$" && src[j + 1] === "{") {
          depth++;
          j += 2;
        } else if (depth > 0 && src[j] === "}") {
          depth--;
          j++;
        } else j++;
      }
      blank(i + 1, Math.min(j, n));
      i = j + 1;
      prevSig = "`";
    } else if (ch === "/" && /[(,=:[!&|?{};]|^$/.test(prevSig)) {
      // Regex literal.
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "[") {
          inClass = true;
          j++;
        } else if (src[j] === "]") {
          inClass = false;
          j++;
        } else if (src[j] === "/" && !inClass) break;
        else j++;
      }
      blank(i + 1, Math.min(j, n));
      i = j + 1;
      prevSig = "/";
    } else {
      if (!/\s/.test(ch)) prevSig = ch;
      i++;
    }
  }
  return out.join("");
}

/** End of the initializer starting at `from`: depth-0 `;`, or a depth-0 newline before a top-level keyword line. */
function initializerEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) depth--;
    else if (depth <= 0 && c === ";") return i;
    else if (depth <= 0 && c === "\n") {
      const rest = src.slice(i + 1, i + 40);
      if (/^(export|const|let|var|function|async\s+function|import|type|interface|class)\b/.test(rest)) return i;
    }
  }
  return src.length;
}

/** Local names under which public builders are available in this file. */
function builderNames(stripped, originalImportsSrc) {
  const names = new Map(); // local name -> canonical builder
  const namespaces = new Set();
  // Imports are parsed from the ORIGINAL text (module specifiers are strings, which we blanked elsewhere).
  const importRe = /import\s+(?:type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
  for (const m of originalImportsSrc.matchAll(importRe)) {
    const spec = m[2];
    const fromServer = /(^|\/)_generated\/server(\.js)?$/.test(spec);
    const fromConvexServer = spec === "convex/server";
    if (!fromServer && !fromConvexServer) continue;
    // Skip imports that are inside comments: the blanked text must still contain `import`.
    if (!stripped.slice(m.index, m.index + 6).startsWith("import")) continue;
    const clause = m[1];
    const ns = /\*\s+as\s+(\w+)/.exec(clause);
    if (ns) namespaces.add(ns[1]);
    const braces = /\{([^}]*)\}/.exec(clause);
    if (!braces) continue;
    for (const part of braces[1].split(",")) {
      const p = part.trim().replace(/^type\s+/, "");
      if (!p) continue;
      const [imported, local] = p.split(/\s+as\s+/).map((x) => x.trim());
      const canonical = PUBLIC_BUILDERS.includes(imported) && fromServer ? imported : GENERIC_BUILDERS[imported];
      if (canonical) names.set(local || imported, canonical);
    }
  }
  // Plain aliases: `const q = query;`
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of stripped.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=;]*)?=\s*(\w+)\s*;/g)) {
      if (names.has(m[2]) && !names.has(m[1])) {
        names.set(m[1], names.get(m[2]));
        changed = true;
      }
    }
  }
  return { names, namespaces };
}

function findBuilderUse(text, { names, namespaces }) {
  for (const [local, canonical] of names) {
    if (new RegExp(`(?<![\\w.$])${local}(?=\\s*[(,)<])`).test(text)) return canonical;
  }
  for (const ns of namespaces) {
    const m = new RegExp(`\\b${ns}\\.(${[...PUBLIC_BUILDERS, ...Object.keys(GENERIC_BUILDERS)].join("|")})\\b`).exec(text);
    if (m) return GENERIC_BUILDERS[m[1]] ?? m[1];
  }
  return null;
}

function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "_generated" || name === "node_modules") continue;
      walk(full, files);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) files.push(full);
  }
  return files;
}

/** Analyses one file; returns { violations, checked }. */
export function analyzeFile(file, rootDir, label = file) {
  const src = readFileSync(file, "utf8");
  const stripped = blankNoise(src);
  const rel = relative(rootDir, file).split(sep).join("/");
  const lines = src.split("\n");
  const strippedLines = stripped.split("\n");
  const violations = [];
  let checked = 0;
  const isInternalOnly =
    rel.startsWith("lib/") || /\.test\.ts$/.test(rel) || rel === "test.setup.ts" || /(^|\/)test\.setup\.ts$/.test(rel);

  const builders = builderNames(stripped, src);

  // ---- Rule 4: helper/test modules must not use public builders at all.
  if (isInternalOnly) {
    const used = findBuilderUse(stripped, builders);
    if (used) {
      violations.push(`${label}: ${rel} uses the public builder '${used}'. Helpers/tests under convex/ must not create public functions; use internalQuery/internalMutation/internalAction or a plain function`);
    }
    return { violations, checked };
  }

  if (/\bauthorizeInbound\s*\(/.test(stripped) && !AUTHORIZE_DEF_RE.test(stripped)) {
    violations.push(`${label}: authorizeInbound is used but not defined with a verifyBearer( call`);
  }

  // Re-exports hide functions from this check.
  for (const m of stripped.matchAll(/\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s*)?from\b/g)) {
    violations.push(`${label}:${lineOf(src, m.index)}: re-export ('export ... from') is not allowed in convex/ modules (it would publish functions without an AUTH annotation)`);
  }

  // ---- Collect declarations whose initializer uses a public builder.
  /** @type {{name:string,declIdx:number,exportIdx:number,exported:boolean,builder:string,initStart:number,initEnd:number}[]} */
  const decls = [];
  const declRe = /(?:^|[\s;{}])(export\s+)?(?:const|let|var)\s+(\w+)\s*(?::[^=;]*)?=(?!=)/g;
  for (const m of stripped.matchAll(declRe)) {
    const initStart = m.index + m[0].length;
    const initEnd = initializerEnd(stripped, initStart);
    const text = stripped.slice(initStart, initEnd);
    const builder = findBuilderUse(text, builders);
    if (!builder) continue;
    const declIdx = m.index + m[0].search(/\S/);
    decls.push({ name: m[2], declIdx, exported: Boolean(m[1]), builder, initStart, initEnd });
  }

  // ---- Which declarations become public exports?
  const publicExports = []; // { name, declIdx, builder, initStart, initEnd }
  for (const d of decls) if (d.exported) publicExports.push(d);
  // `export { a, b as c }` of builder consts
  for (const m of stripped.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/g)) {
    for (const part of m[1].split(",")) {
      const local = part.trim().split(/\s+as\s+/)[0]?.trim();
      const d = decls.find((x) => x.name === local && !x.exported);
      if (d && !publicExports.includes(d)) publicExports.push(d);
    }
  }
  // `export default <ident | builder call>`
  for (const m of stripped.matchAll(/\bexport\s+default\s+/g)) {
    const start = m.index + m[0].length;
    const end = initializerEnd(stripped, start);
    const text = stripped.slice(start, end);
    const direct = findBuilderUse(text, builders);
    const ident = /^(\w+)\s*;?\s*$/.exec(text.trim())?.[1];
    const viaDecl = ident ? decls.find((x) => x.name === ident) : undefined;
    if (direct) {
      publicExports.push({ name: "default", declIdx: m.index, builder: direct, initStart: start, initEnd: end });
    } else if (viaDecl && !publicExports.includes(viaDecl)) {
      publicExports.push(viaDecl);
    } else if (viaDecl) {
      // already covered (exported const also default-exported): still fine
    }
  }

  for (const e of publicExports) {
    checked++;
    const lineNo = lineOf(src, e.declIdx);
    const where = `${label}:${lineNo} ${e.name}`;

    // Contiguous `//` comment lines directly above (real comments only: the blanked line must be empty).
    const comments = [];
    for (
      let i = lineNo - 2;
      i >= 0 && lines[i].trim().startsWith("//") && (strippedLines[i] ?? "").trim() === "";
      i--
    ) {
      comments.push(lines[i].trim());
    }
    const authLine = comments.find((c) => /^\/\/\s*AUTH:/.test(c));
    if (!authLine) {
      violations.push(`${where}: missing '// AUTH:' comment immediately above the export`);
      continue;
    }
    const decision = authLine.replace(/^\/\/\s*AUTH:\s*/, "");
    const claimsPublic = /^(public|identity-only)\b/i.test(decision);
    if (claimsPublic) {
      if (!PUBLIC_ALLOWLIST.has(`${rel}#${e.name}`)) {
        violations.push(`${where}: claims '${decision.split(/[.(]/)[0].trim()}' but ${rel}#${e.name} is not in PUBLIC_ALLOWLIST (scripts/check-authz.mjs). Add a guard, or review and allowlist it deliberately`);
      }
      continue;
    }

    const body = stripped.slice(e.initStart, e.initEnd);
    if (e.builder === "httpAction") {
      if (!HTTP_GUARD_RE.test(body)) {
        violations.push(`${where}: AUTH says '${decision}' but no authorizeInbound( / verifyBearer( call found in the httpAction (comments/strings do not count)`);
      }
      continue;
    }
    if (!GUARD_RE.test(body)) {
      violations.push(`${where}: AUTH says '${decision}' but no requireUser/requireAdmin/requireToolOwner/requireLoanParty call found in code (comments/strings do not count)`);
    }
  }
  return { violations, checked };
}

export function runCheck(rootDir, displayRoot = process.cwd()) {
  const violations = [];
  let checked = 0;
  let files = 0;
  for (const file of walk(rootDir)) {
    files++;
    const label = relative(displayRoot, file).split(sep).join("/");
    const r = analyzeFile(file, rootDir, label);
    violations.push(...r.violations);
    checked += r.checked;
  }
  return { violations, checked, files };
}

// CLI
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const idx = process.argv.indexOf("--root");
  const root = resolve(idx > -1 ? (process.argv[idx + 1] ?? "") : join(process.cwd(), "convex"));
  const { violations, checked, files } = runCheck(root);
  if (violations.length > 0) {
    console.error(`authz check FAILED (${violations.length} violation(s)):`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(`authz check passed (${checked} public function(s) checked in ${files} file(s))`);
}
