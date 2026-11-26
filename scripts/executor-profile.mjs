#!/usr/bin/env node
// Executor permission profile (ADR-0040, ARCHITECTURE §7.2): builds the Claude Code managed
// settings for one headless run from platform/executor/profile.json, the run's step and the
// project's CODEOWNERS. Every CODEOWNERS path becomes an `Edit` deny, so the agent can't change
// owned files; the workflow installs the result as /etc/claude-code/managed-settings.json.
//
// Usage: executor-profile.mjs --step <step> --out <file> [--codeowners <file>] [--root <dir>]
//        [--profile <profile.json>] [--verify-host <host>]
// --verify-host fills `${VERIFY_HOST}` in a step's rules (the verify step, AI-188); a step that
// names it is refused without a valid host.
// --root is the project checkout (default: cwd); CODEOWNERS paths are anchored there.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const DEFAULT_PROFILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "platform",
  "executor",
  "profile.json",
);

/** CODEOWNERS patterns (gitignore-style) of lines that name at least one owner. */
export function codeownersPatterns(text) {
  const patterns = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    // Pattern = first run of non-whitespace, where `\ ` and `\#` are escapes.
    const match = line.match(/^((?:\\.|[^\s\\])+)(.*)$/);
    if (!match) continue;
    const owners = match[2].replace(/\s#.*$/, "").trim();
    // A pattern with no owners un-owns files; skipping it keeps the earlier, wider deny.
    if (owners === "") continue;
    patterns.push(match[1].replace(/\\(.)/g, "$1"));
  }
  return patterns;
}

/**
 * Converts one CODEOWNERS pattern to permission-rule paths anchored at `root` (absolute, as
 * `//abs/...`). Leading `/` or a slash in the middle = relative to the repo root; no slash = any
 * depth; trailing `/` = directory contents. A pattern that may name a directory also covers
 * everything under it.
 */
export function toRulePaths(pattern, root) {
  const anchor = `/${resolve(root)}`.replace(/\/+$/, "");
  let p = pattern;
  const isDir = p.endsWith("/");
  p = p.replace(/\/+$/, "");
  if (p === "" || p === "*" || p === "/*" || p === "**" || p === "/**") return [`${anchor}/**`];
  const anchored = p.startsWith("/") || p.includes("/");
  p = p.replace(/^\/+/, "");
  const body = anchored ? `${anchor}/${p}` : `${anchor}/**/${p}`;
  if (isDir) return [`${body}/**`];
  if (p.endsWith("/**") || p.endsWith("/*")) return [body];
  return [body, `${body}/**`];
}

/** Catch-all CODEOWNERS patterns: they request Andy's review on every PR, they protect nothing. */
export const CATCH_ALL = new Set(["*", "/*", "**", "/**"]);

/** Replaces `${ROOT}` in every string of a JSON value with the checkout's absolute path. */
function withRoot(value, root) {
  return JSON.parse(JSON.stringify(value).replaceAll("${ROOT}", resolve(root)));
}

/**
 * Merges the base settings, the step's allow/deny rules, the step's sandbox and CODEOWNERS Edit
 * denies (every owned pattern but the catch-all, ARCHITECTURE §4.5).
 */
/**
 * Steps that run under another step's rules. A sync run (AI-72, ADR-0083) merges main and runs the
 * project's checks: exactly the build's tools and sandbox, so it can't drift from them.
 */
export const STEP_ALIASES = { sync: "build" };

/**
 * A lowercase DNS host name: labels of letters, digits and inner hyphens, at least one dot, and a
 * last label that starts with a letter, so no IP address (a metadata endpoint) gets through.
 */
export const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Fills `${VERIFY_HOST}` in the step's rules; refuses a step that needs it without a valid host. */
function withVerifyHost(stepRules, verifyHost) {
  const text = JSON.stringify(stepRules);
  if (!text.includes("${VERIFY_HOST}")) return stepRules;
  if (!verifyHost || verifyHost.length > 253 || !HOST.test(verifyHost)) {
    throw new Error("this step needs --verify-host <host>");
  }
  return JSON.parse(text.replaceAll("${VERIFY_HOST}", verifyHost));
}

export function buildProfile({ profile, step, codeowners = "", root, verifyHost = "" }) {
  const rulesFor = Object.hasOwn(STEP_ALIASES, step) ? STEP_ALIASES[step] : step;
  const found = Object.hasOwn(profile.steps, rulesFor) ? profile.steps[rulesFor] : null;
  if (!found) throw new Error(`unknown step "${step}"`);
  const stepRules = withVerifyHost(found, verifyHost);
  const settings = JSON.parse(JSON.stringify(profile.settings));
  if (stepRules.sandbox) settings.sandbox = withRoot(stepRules.sandbox, root ?? process.cwd());
  const ownedPaths = codeownersPatterns(codeowners)
    .filter((p) => !CATCH_ALL.has(p))
    .flatMap((p) => toRulePaths(p, root));
  const permissions = settings.permissions;
  permissions.allow = [...new Set([...(permissions.allow ?? []), ...stepRules.allow])];
  permissions.deny = [
    ...new Set([
      ...(permissions.deny ?? []),
      ...(stepRules.deny ?? []),
      ...ownedPaths.map((path) => `Edit(${path})`),
    ]),
  ];
  return settings;
}

function main() {
  const { values } = parseArgs({
    options: {
      step: { type: "string" },
      out: { type: "string" },
      codeowners: { type: "string" },
      root: { type: "string" },
      profile: { type: "string" },
      "verify-host": { type: "string" },
    },
  });
  if (!values.step || !values.out) throw new Error("--step and --out are required");
  const profile = JSON.parse(readFileSync(values.profile ?? DEFAULT_PROFILE, "utf8"));
  const codeowners =
    values.codeowners && existsSync(values.codeowners)
      ? readFileSync(values.codeowners, "utf8")
      : "";
  const settings = buildProfile({
    profile,
    step: values.step,
    codeowners,
    root: values.root ?? process.cwd(),
    verifyHost: values["verify-host"] ?? "",
  });
  writeFileSync(values.out, `${JSON.stringify(settings, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`executor-profile: ${error.message}\n`);
    process.exitCode = 1;
  }
}
