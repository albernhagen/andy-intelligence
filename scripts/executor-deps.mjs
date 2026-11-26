#!/usr/bin/env node
// The trusted install of a build's plan-named packages (AI-386, ADR-0156), run from the platform
// checkout, never the project's. `add` runs in the executor's `deps` job, which holds no model
// credential, no OIDC token and no write token; `apply` runs in the `agent` job before the
// sandboxed agent starts. The sandbox stays as it was: the agent can't install anything itself.
//
// Usage: executor-deps.mjs add | apply
//   add: env PACKAGES (the run context's `packages`, JSON), WORKSPACE (the project checkout),
//     OUT (an empty directory). Re-checks every package, then per workspace and kind runs
//     `pnpm add --lockfile-only` with install scripts and pnpmfile hooks off and a 7-day
//     release-age cooldown, so pnpm picks the newest version at least 7 days old and no package
//     code runs. Refuses any change but the named workspaces' package.json and pnpm-lock.yaml,
//     then copies those files to OUT with the commit they were made on (`base.sha`).
//   apply: env PACKAGES, WORKSPACE, IN (the downloaded `add` output), HEAD_SHA (the agent's
//     checkout). Refuses unless IN was made on HEAD_SHA and holds exactly the expected regular
//     files, each named package is in its package.json, then copies them into the checkout.
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The 7-day cooldown Dependabot already uses, in minutes (pnpm's `minimumReleaseAge`). */
export const RELEASE_AGE_MINUTES = 7 * 24 * 60;
/** Same caps as the plan schema (`PACKAGE_LIMITS`, ADR-0028). */
export const MAX_PACKAGES = 5;
/** A manifest or lockfile bigger than this is refused (the change cap is 5 MB). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const LOCKFILE = "pnpm-lock.yaml";

const NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const WORKSPACE = /^(\.|[A-Za-z0-9_@][A-Za-z0-9._@-]*(\/[A-Za-z0-9_@][A-Za-z0-9._@-]*)*)$/;

/** The packages, checked again here (untrusted until now); throws with the reason. */
export function parsePackages(json) {
  let list;
  try {
    list = JSON.parse(json ?? "");
  } catch {
    throw new Error("the packages aren't JSON");
  }
  if (!Array.isArray(list) || list.length === 0) throw new Error("no packages to install");
  if (list.length > MAX_PACKAGES) {
    throw new Error(`${list.length} packages; the cap is ${MAX_PACKAGES} per ticket`);
  }
  const seen = new Set();
  return list.map((p) => {
    const { name, kind, workspace } = p ?? {};
    if (typeof name !== "string" || name.length > 214 || !NAME.test(name)) {
      throw new Error(`"${String(name).slice(0, 80)}" isn't an npm package name`);
    }
    if (kind !== "runtime" && kind !== "dev")
      throw new Error(`${name}: kind must be runtime or dev`);
    if (
      typeof workspace !== "string" ||
      workspace.length > 300 ||
      !WORKSPACE.test(workspace) ||
      workspace.split("/").includes("..")
    ) {
      throw new Error(
        `${name}: "${String(workspace).slice(0, 80)}" isn't a repo-relative directory`,
      );
    }
    if (seen.has(name)) throw new Error(`${name} is named twice`);
    seen.add(name);
    return { name, kind, workspace };
  });
}

/** The manifest path of a workspace, repo-relative. */
export const manifestOf = (workspace) =>
  workspace === "." ? "package.json" : `${workspace}/package.json`;

/** The files `add` may change: each named workspace's package.json and the lockfile. */
export function expectedFiles(packages) {
  return [...new Set(packages.map((p) => manifestOf(p.workspace))), LOCKFILE].sort();
}

/**
 * The pnpm commands, one per workspace and kind, in a fixed order. Names are checked, so none
 * starts with `-`; every safety flag is explicit, whatever the project's .npmrc says.
 */
export function addCommands(packages, isWorkspace) {
  const groups = new Map();
  for (const p of packages) {
    const key = `${p.workspace}\0${p.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), p.name]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, names]) => {
      const [workspace, kind] = key.split("\0");
      return [
        "--dir",
        workspace,
        "add",
        ...(kind === "dev" ? ["--save-dev"] : []),
        ...(workspace === "." && isWorkspace ? ["--workspace-root"] : []),
        "--lockfile-only",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        `--config.minimum-release-age=${RELEASE_AGE_MINUTES}`,
        ...names,
      ];
    });
}

/** Throws unless `rel` is a real directory inside `root` holding a package.json (no symlinks). */
function checkWorkspaceDir(root, rel) {
  const dir = join(root, rel);
  const real = realpathSync(dir);
  const inside = relative(realpathSync(root), real);
  if (inside.startsWith("..") || inside.split(sep).includes("..")) {
    throw new Error(`${rel} is outside the repo`);
  }
  const manifest = join(root, manifestOf(rel));
  if (!existsSync(manifest) || !lstatSync(manifest).isFile()) {
    throw new Error(`${rel} has no package.json`);
  }
}

/** Repo-relative paths git reports as changed or new, sorted. */
function changedFiles(root) {
  const out = execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: root, encoding: "utf8" },
  );
  return out
    .split("\0")
    .filter(Boolean)
    .map((line) => line.slice(3))
    .sort();
}

/** Throws unless `actual` is exactly `expected`. */
export function checkFileSet(actual, expected, what) {
  const extra = actual.filter((f) => !expected.includes(f));
  const missing = expected.filter((f) => !actual.includes(f));
  if (extra.length > 0) throw new Error(`${what} changed files it may not: ${extra.join(", ")}`);
  if (missing.length > 0) throw new Error(`${what} is missing ${missing.join(", ")}`);
}

/** Throws unless each package is in its workspace manifest, under the right kind. */
export function checkManifests(dir, packages) {
  for (const p of packages) {
    const manifest = JSON.parse(readFileSync(join(dir, manifestOf(p.workspace)), "utf8"));
    const section = p.kind === "dev" ? manifest.devDependencies : manifest.dependencies;
    if (!section || typeof section[p.name] !== "string") {
      throw new Error(`${p.name} isn't in ${manifestOf(p.workspace)} after the install`);
    }
  }
}

/** Every regular file under `dir`, repo-relative; throws on a symlink or anything else. */
function filesUnder(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) return filesUnder(join(dir, e.name), rel);
    if (!e.isFile()) throw new Error(`${rel} isn't a regular file`);
    return [rel];
  });
}

/**
 * Runs pnpm, echoing its output; on failure throws with pnpm's own reason (its last `ERR_PNPM`
 * line, else its last line), which the ticket shows. Registry text: data, capped.
 */
export function runPnpm(args, opts, spawn = spawnSync) {
  const r = spawn("pnpm", args, { ...opts, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  process.stdout.write(output);
  if (r.status === 0) return;
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const reason =
    lines.findLast((l) => l.includes("ERR_PNPM")) ?? lines.at(-1) ?? String(r.error ?? "");
  const names = args.slice(args.indexOf("--config.minimum-release-age=" + RELEASE_AGE_MINUTES) + 1);
  throw new Error(`pnpm couldn't add ${names.join(", ")}: ${reason.slice(0, 200)}`);
}

export function add({ packagesJson, workspace, out, run = runPnpm }) {
  const packages = parsePackages(packagesJson);
  for (const p of packages) checkWorkspaceDir(workspace, p.workspace);
  const isWorkspace = existsSync(join(workspace, "pnpm-workspace.yaml"));
  // No model credential or token exists in this job; the env is still kept to what pnpm needs.
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", CI: "true" };
  for (const args of addCommands(packages, isWorkspace)) {
    process.stdout.write(`pnpm ${args.join(" ")}\n`);
    run(args, { cwd: workspace, env });
  }
  const expected = expectedFiles(packages);
  checkFileSet(changedFiles(workspace), expected, "The install");
  checkManifests(workspace, packages);
  for (const file of expected) {
    mkdirSync(dirname(join(out, file)), { recursive: true });
    copyFileSync(join(workspace, file), join(out, file));
  }
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" });
  writeFileSync(join(out, "base.sha"), sha.trim());
  return expected;
}

export function apply({ packagesJson, workspace, input, headSha }) {
  const packages = parsePackages(packagesJson);
  const made = readFileSync(join(input, "base.sha"), "utf8").trim();
  if (!/^[0-9a-f]{40}$/.test(headSha ?? "") || made !== headSha) {
    throw new Error(
      `the packages were resolved on ${made.slice(0, 12)}, the build starts from ${String(headSha).slice(0, 12)}; start the build again`,
    );
  }
  const expected = expectedFiles(packages);
  const files = filesUnder(input)
    .filter((f) => f !== "base.sha")
    .sort();
  checkFileSet(files, expected, "The resolved packages");
  for (const file of files) {
    if (lstatSync(join(input, file)).size > MAX_FILE_BYTES) throw new Error(`${file} is too big`);
  }
  checkManifests(input, packages);
  for (const p of packages) checkWorkspaceDir(workspace, p.workspace);
  for (const file of files) copyFileSync(join(input, file), join(workspace, file));
  return files;
}

function main() {
  const [command] = process.argv.slice(2);
  const { PACKAGES, WORKSPACE: root, OUT, IN, HEAD_SHA } = process.env;
  try {
    if (command === "add") {
      const files = add({ packagesJson: PACKAGES, workspace: root, out: OUT });
      process.stdout.write(`Resolved: ${files.join(", ")}\n`);
    } else if (command === "apply") {
      const files = apply({
        packagesJson: PACKAGES,
        workspace: root,
        input: IN,
        headSha: HEAD_SHA,
      });
      process.stdout.write(`Applied: ${files.join(", ")}\n`);
    } else {
      throw new Error("usage: executor-deps.mjs add | apply");
    }
  } catch (err) {
    // One line, last: the workflow reports it on the ticket.
    const reason = String(err?.message ?? err)
      .replace(/\s+/g, " ")
      .slice(0, 300);
    process.stderr.write(`${reason}\n`);
    if (process.env.ERROR_FILE) writeFileSync(process.env.ERROR_FILE, reason);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
