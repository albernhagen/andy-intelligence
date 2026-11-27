#!/usr/bin/env node
// Review scope (ADR-0030, ADR-0037): docs-only PRs skip the review agents to save subscription quota.
// Agent-facing rule files are never "docs": a PR that edits them still gets reviewed.
// The same rule lets UI screenshots skip a docs-only PR (AI-358).
// A Dependabot PR that only moves dependency versions within their major also skips the agents
// (AI-394); the caller checks the PR author, this file checks the change.
//
// Default CLI: reads changed paths (one per line) from stdin; prints "true" when the PR is docs-only.
// `--gate <base-ref>`: diffs <base-ref> against HEAD itself and prints `run=true` or `run=false`
// for $GITHUB_OUTPUT. Any failure to read the change (bad ref, no git, empty diff) prints
// `run=true`, so the check runs its full work.
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

/** `run=false` only when `listPaths()` succeeds and the change is docs-only; fails safe to `run=true`. */
export function gateOutput(listPaths) {
  try {
    return `run=${!isDocsOnly(listPaths())}`;
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
