#!/usr/bin/env node
// Review scope (ADR-0030, ADR-0037): docs-only PRs skip the review agents to save subscription quota.
// Agent-facing rule files are never "docs": a PR that edits them still gets reviewed.
// The same rule lets UI screenshots skip a docs-only PR (AI-358); a second, separate rule lets
// them skip a PR that changes no file the web app's render depends on (AI-406, canAffectWebApp).
// A Dependabot PR that only moves dependency versions within their major also skips the agents
// (AI-394); the caller checks the PR author, this file checks the change.
//
// Default CLI: reads changed paths (one per line) from stdin; prints "true" when the PR is docs-only.
// `--gate <base-ref>`: the UI screenshots gate. Diffs <base-ref> against HEAD itself and prints
// `run=true`, or `run=false` plus a `reason=` line, for $GITHUB_OUTPUT. Any failure to read the
// change (bad ref, no git, empty diff) prints `run=true`, so the check runs its full work.
// `--dependency-bump <base-ref>`: prints "true" when the change from <base-ref> to HEAD is a
// minor or patch dependency bump (isDependencyBump); any failure prints "false", so agents run.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOCS = [/^docs\//, /^[^/]+\.md$/, /^(apps|packages)\/[^/]+\/README\.md$/];
const AGENT_RULES = new Set(["AGENTS.md", "CLAUDE.md", "docs/BUILD-PROMPT.md"]);

/** True when every changed path is documentation an agent doesn't take rules from. */
export function isDocsOnly(paths) {
  const files = paths.map((p) => p.trim()).filter((p) => p !== "");
  if (files.length === 0) return false;
  return files.every((f) => !AGENT_RULES.has(f) && DOCS.some((pattern) => pattern.test(f)));
}

const MANIFEST = /(^|\/)package\.json$/;
// Only pnpm lockfiles are parsed; an npm or yarn lockfile change always gets reviewed.
const LOCKFILE = /(^|\/)pnpm-lock\.yaml$/;
// Workflows, baseline actions and procedures, the template and Terraform always get reviewed.
const ALWAYS_REVIEW = /^(\.github|infra|platform|template)\//;
const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
// A plain version or caret/tilde range: "1.2.3", "^1.2.3", "~1.2". Anything else (">=", "||",
// workspace:, npm: aliases, URLs, prereleases) isn't a simple bump.
const SIMPLE_RANGE = /^([\^~]?)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

/**
 * What a version or range must keep across a minor bump: its operator and its semver major (the
 * first number, or 0.<minor> below 1.0), e.g. "^|1". Null when it isn't a simple version or range.
 */
function majorOf(range) {
  const m = SIMPLE_RANGE.exec(String(range).trim());
  if (!m) return null;
  if (m[2] !== "0") return `${m[1]}|${m[2]}`;
  return m[3] === undefined ? null : `${m[1]}|0.${m[3]}`;
}

/** Resolved versions per package name in a pnpm lockfile's `packages:` section (v9 keys). */
export function lockedPackages(lockText) {
  const packages = new Map();
  let inPackages = false;
  for (const line of lockText.split("\n")) {
    if (/^\S/.test(line)) inPackages = line.trimEnd() === "packages:";
    const key = inPackages && /^ {2}'?((?:@[^@/\s]+\/)?[^@\s']+)@([^'\s]+)'?:\s*$/.exec(line);
    if (!key) continue;
    if (!packages.has(key[1])) packages.set(key[1], new Set());
    packages.get(key[1]).add(key[2]);
  }
  return packages;
}

/**
 * True when a pnpm lockfile adds no package and every newly resolved version stays within the
 * major of a version already locked for that package. Removed packages are fine.
 */
function isMinorLockChange(baseText, headText) {
  const base = lockedPackages(baseText);
  const head = lockedPackages(headText);
  if (base.size === 0) return false; // unreadable or not a v9 lockfile
  for (const [name, versions] of head) {
    const before = base.get(name);
    if (!before) return false;
    const majors = new Set([...before].map(majorOf));
    for (const v of versions) {
      if (before.has(v)) continue;
      const major = majorOf(v);
      if (major === null || !majors.has(major)) return false;
    }
  }
  return true;
}

/** True when a package.json changed only dependency versions, each within its major. */
function isMinorManifestChange(baseText, headText) {
  const base = JSON.parse(baseText);
  const head = JSON.parse(headText);
  const rest = (pkg) =>
    JSON.stringify({ ...pkg, ...Object.fromEntries(DEP_FIELDS.map((f) => [f, null])) });
  // scripts, pnpm overrides, packageManager and every other field must be untouched.
  if (rest(base) !== rest(head)) return false;
  return DEP_FIELDS.every((field) => {
    const from = base[field] ?? {};
    const to = head[field] ?? {};
    const names = Object.keys(from);
    if (names.join("\n") !== Object.keys(to).join("\n")) return false; // added, removed or moved
    return names.every((name) => {
      if (from[name] === to[name]) return true;
      const major = majorOf(from[name]);
      return major !== null && major === majorOf(to[name]);
    });
  });
}

/**
 * True when every changed path is a package manifest or lockfile outside the always-reviewed
 * folders, and each changed package.json only moves existing dependency versions within their
 * major (same range operator), and each changed pnpm lockfile adds no package and resolves new
 * versions only within a locked major. `read(side, path)` returns the file's text on "base" or
 * "head", or null if absent there.
 */
export function isDependencyBump(paths, read) {
  const files = paths.map((p) => p.trim()).filter((p) => p !== "");
  if (files.length === 0) return false;
  if (!files.every((f) => (MANIFEST.test(f) || LOCKFILE.test(f)) && !ALWAYS_REVIEW.test(f))) {
    return false;
  }
  return files.every((f) => {
    const base = read("base", f);
    const head = read("head", f);
    if (base === null || head === null) return false;
    return MANIFEST.test(f) ? isMinorManifestChange(base, head) : isMinorLockChange(base, head);
  });
}

/** "true" only when the change can be read and is a minor or patch bump; fails safe to "false". */
export function dependencyBumpOutput(listPaths, read) {
  try {
    return String(isDependencyBump(listPaths(), read));
  } catch {
    return "false";
  }
}

/** A file's text at `ref` in the current git checkout, or null when git can't show it. */
export function fileAt(ref, path) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

// What the web app renders in the screenshot checks (AI-406), derived from the code, not memory:
// - the app itself (src, e2e specs, stored images, its fake API and seeds in e2e/, its Vite,
//   Tailwind and TypeScript config);
// - every workspace package it imports, directly or through another (WEB_WORKSPACE_DEPS; a test
//   rebuilds this from the package.json files and fails if it grows);
// - files outside those packages that their sources import (platform/baseline, from apps/api;
//   a test scans the relative imports);
// - root install and build config, and what the Playwright webServer command runs (gen-exports);
// - the screenshot check's own gate, image check, workflow and action.
export const WEB_WORKSPACE_DEPS = [
  "apps/api",
  "packages/contracts",
  "packages/domain",
  "packages/github",
  "packages/store",
];
export const AFFECTS_WEB_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".nvmrc",
  "tsconfig.base.json",
  "scripts/gen-exports.mjs",
  "scripts/review-scope.mjs",
  "scripts/playwright-image.mjs",
  ".github/workflows/ui-screenshots.yml",
]);
export const AFFECTS_WEB_DIRS = [
  "apps/web",
  ...WEB_WORKSPACE_DEPS,
  "platform/baseline",
  "platform/actions/ui-screenshots",
];

// Paths known not to reach the web app's render. Only these can be skipped: a path on neither
// list (a new top-level file, a new workspace package, .gitignore) runs the suite.
const CANNOT_AFFECT_WEB = [
  /^docs\//,
  /^[^/]+\.md$/,
  /^LICENSE$/,
  /^(infra|template|\.claude)\//,
  /^apps\/local-runner\//, // a workspace package apps/web doesn't import
  /^\.github\//, // other workflows and repo config (ui-screenshots.yml is in AFFECTS_WEB_FILES)
  /^platform\/(actions|procedures|evals|executor)\//, // other actions (not ui-screenshots)
  /^scripts\//, // repo CLIs; the ones the check runs are in AFFECTS_WEB_FILES
  // Root tooling the screenshot run never reads: lint, format, hooks, unit tests, the API image,
  // the Firestore emulator, Terraform's version, context budgets.
  /^(eslint\.config\.js|\.prettierrc\.json|\.prettierignore|lefthook\.yml|vitest\.config\.ts|vitest\.temp-dir\.ts|Dockerfile|\.dockerignore|firebase\.json|\.terraform-version|context-budget\.json)$/,
];

/**
 * True unless `path` is provably irrelevant to what the web app renders: it is on the known
 * can't-affect list and not under anything the app depends on. Unknown paths count as affecting.
 */
export function canAffectWebApp(path) {
  if (AFFECTS_WEB_FILES.has(path) || AFFECTS_WEB_DIRS.some((dir) => path.startsWith(`${dir}/`))) {
    return true;
  }
  return !CANNOT_AFFECT_WEB.some((pattern) => pattern.test(path));
}

/** Why the screenshot checks may skip this change, or null when they must run. */
export function screenshotSkipReason(paths) {
  const files = paths.map((p) => p.trim()).filter((p) => p !== "");
  if (files.length === 0) return null;
  if (isDocsOnly(files)) return "docs-only change";
  if (!files.some(canAffectWebApp)) return "no changed file can affect what the web app renders";
  return null;
}

/**
 * `run=false` plus `reason=…` only when `listPaths()` succeeds and the change is docs-only or
 * can't affect the web app; fails safe to `run=true`.
 */
export function gateOutput(listPaths) {
  try {
    const reason = screenshotSkipReason(listPaths());
    return reason === null ? "run=true" : `run=false\nreason=${reason}`;
  } catch {
    return "run=true";
  }
}

/** Changed paths between `baseRef` and HEAD in the current git checkout; throws if git can't say. */
export function changedPaths(baseRef) {
  if (!baseRef) throw new Error("no base ref");
  return execFileSync("git", ["diff", "--name-only", "--no-renames", baseRef, "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"], // git's error reaches the job log
  }).split("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const gate = process.argv.indexOf("--gate");
  const bump = process.argv.indexOf("--dependency-bump");
  if (bump !== -1) {
    const baseRef = process.argv[bump + 1];
    const read = (side, path) => fileAt(side === "base" ? baseRef : "HEAD", path);
    process.stdout.write(`${dependencyBumpOutput(() => changedPaths(baseRef), read)}\n`);
  } else if (gate !== -1) {
    process.stdout.write(`${gateOutput(() => changedPaths(process.argv[gate + 1]))}\n`);
  } else {
    process.stdout.write(String(isDocsOnly(readFileSync(0, "utf8").split("\n"))));
  }
}
