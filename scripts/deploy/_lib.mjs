// Shared helpers for scripts/deploy/*. No dependencies. Never prints secret values: only names and lengths.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

/** Directory holding secret files and deploy.json. Outside the repo; override with DEPLOY_SECRETS_DIR. */
export const secretsDir = process.env.DEPLOY_SECRETS_DIR ?? "D:\\Freelance\\Fluence International\\.tmp\\deploy-secrets";

export function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

/** Names and lengths only. */
export function describe(name, value) {
  return `${name} (${value.length} chars)`;
}

let cachedConfig;
function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const file = join(secretsDir, "deploy.json");
  if (!existsSync(file)) return (cachedConfig = {});
  try {
    cachedConfig = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail(`${file} is not valid JSON`);
  }
  return cachedConfig;
}

/** Non-secret setting: environment variable first, then deploy.json in the secrets dir. Returns "" when unset. */
export function setting(name) {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv.trim();
  const fromFile = loadConfig()[name];
  return typeof fromFile === "string" ? fromFile.trim() : "";
}

export function requireSetting(name, hint) {
  const v = setting(name);
  if (!v) fail(`${name} is not set (env var or deploy.json in ${secretsDir}). ${hint ?? ""}`.trim());
  return v;
}

/** Secret: a file in the secrets dir (trimmed). Returns "" when missing and not required. */
export function readSecret(file, { required = true } = {}) {
  const path = join(secretsDir, file);
  if (!existsSync(path)) {
    if (required) fail(`secret file missing: ${path} (run gen-secrets.mjs, or create it yourself)`);
    return "";
  }
  const v = readFileSync(path, "utf8").trim();
  if (!v && required) fail(`secret file is empty: ${path}`);
  return v;
}

// Arguments that reach cmd.exe on Windows must be plain tokens (values travel on stdin, never in args).
const SAFE_ARG = /^[A-Za-z0-9_.:@=,/\\+-]+$/;

/**
 * Runs a program without a shell. `.cmd` shims on Windows (npx, vercel) go through cmd.exe /c with plain-token
 * arguments only. `input` is written to stdin (this is how secret values are passed). Returns {status, stdout, stderr}.
 */
export function run(bin, args, { input, env, capture = false } = {}) {
  let file = bin;
  let argv = args;
  if (process.platform === "win32" && /^(npx|npm|vercel|railway)$/i.test(bin)) {
    for (const a of args) if (!SAFE_ARG.test(a)) fail(`refusing to pass unsafe argument through cmd.exe: ${a.slice(0, 40)}`);
    file = process.env.ComSpec ?? "cmd.exe";
    argv = ["/d", "/s", "/c", bin, ...args];
  }
  const res = spawnSync(file, argv, {
    input,
    env: { ...process.env, ...env },
    stdio: [input === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"],
    encoding: "utf8",
    shell: false,
    cwd: repoRoot,
  });
  if (res.error) fail(`${bin} could not start: ${res.error.message}`);
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Path to the local Convex CLI entry (runs with this node, no shell, no npx). */
export const convexBin = join(repoRoot, "node_modules", "convex", "bin", "main.js");

export function hasFlag(args, flag) {
  return args.includes(flag);
}

export function checkSecretShape(name, value, { min = 1, https = false } = {}) {
  if (value.length < min) fail(`${name} must be at least ${min} characters (got ${value.length})`);
  if (https && !value.startsWith("https://")) fail(`${name} must start with https://`);
  if (/[\r\n]/.test(value)) fail(`${name} must be a single line`);
}
