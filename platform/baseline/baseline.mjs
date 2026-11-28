#!/usr/bin/env node
// Project baseline CLI (ADR-0031, ADR-0038). Runs on Andy's machine with his `gh` login (admin);
// never in CI except `check --only labels,ruleset` in the system security review.
// Runbook: docs/runbooks/onboard-a-repo.md. Needs no andy-intelligence checkout (AI-409):
//
//   npx -y github:albernhagen/andy-intelligence#v1.2.0 <command> ...
//
// It reads the baseline files at the ref through the GitHub API. <owner/repo> defaults to the
// current folder's `origin`; --ref defaults to the newest vX.Y.Z tag.
//
//   baseline.mjs onboard [owner/repo] [--ref <tag|branch|sha>]   files, then apply (a new repo)
//                        or the steps after the PR (an existing repo)
//   baseline.mjs files   [owner/repo] [--ref <tag|branch|sha>]   write baseline files (push or PR)
//                        [--deploy-kind none|cloud-run] the project's `deployKind` (ADR-0114):
//                        `cloud-run` adds deploy.yml and release.yml. Default: what the repo's
//                        .andy/baseline.json records, else `none` (also for onboard and finish)
//                        [--environments prod-only|dev-and-prod] for `cloud-run`: which
//                        template Terraform root to seed in infra/ (AI-109). Default prod-only
//   baseline.mjs apply   [owner/repo] [--dry-run]              GitHub config
//   baseline.mjs check   [owner/repo] [--only a,b]             drift report; exit 1 on drift
//   baseline.mjs finish  [owner/repo] --ref <sha> --branch <baseline/x>
//                        add the workflows and agent settings the App's baseline PR left out
//                        (AI-113) to that PR's branch; only missing ones, never overwrites
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySections, checkSections, configFor, parseConfig, SECTIONS } from "./github.mjs";
import {
  BASELINE_CLI,
  baselineRecord,
  checkDeployKind,
  checkEnvironments,
  fileDrift,
  mergeLines,
  recordedDeployKind,
  renderFiles,
  seedsToWrite,
} from "./files.mjs";
import { heldToAdd } from "./plan.mjs";
import { cleanGitEnv } from "../../scripts/git-env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALL = [...SECTIONS.map((s) => s.name), "files"];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) {
    // With stdio "inherit" the output is already on screen and these are null.
    const output = `${r.stderr ?? ""}${r.stdout ?? ""}`;
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})${output ? `:\n${output}` : ""}`);
  }
  return r;
}

export { configFor };

/** `gh api` with the status code: { status, data }. Never throws on HTTP errors. */
export function ghApi(method, apiPath, body) {
  const args = ["api", "-X", method, "-i", "-H", "X-GitHub-Api-Version: 2022-11-28", apiPath];
  if (body !== undefined) args.push("--input", "-");
  const r = run("gh", args, {
    allowFail: true,
    input: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseGhResponse(r.stdout, r.stderr);
}

/** Splits `gh api -i` output into status and parsed JSON body. */
export function parseGhResponse(stdout, stderr = "") {
  const m = /^HTTP\/[\d.]+ (\d{3})/.exec(stdout);
  if (!m) throw new Error(`gh api: no HTTP status in output:\n${stderr}${stdout}`);
  const split = stdout.search(/\r?\n\r?\n/);
  const raw = split === -1 ? "" : stdout.slice(split).trim();
  let data = null;
  if (raw !== "") {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }
  return { status: Number(m[1]), data };
}

export function loadConfig(dir = path.join(HERE, "github")) {
  return parseConfig((f) => readFileSync(path.join(dir, f), "utf8"));
}

const manifest = () => JSON.parse(readFileSync(path.join(HERE, "manifest.json"), "utf8"));

const MANIFEST_PATH = "platform/baseline/manifest.json";
const SOURCE = manifest().source;

/** How Andy runs this CLI anywhere, pinned to a tag, for the commands it prints (AI-409). */
export const CLI = BASELINE_CLI;

/** A file of the baseline source at `sha`, through the GitHub API; null when it isn't there. */
function readSource(file, sha) {
  const res = ghApi("GET", `repos/${SOURCE}/contents/${encodePath(file)}?ref=${sha}`);
  if (res.status === 404) return null;
  if (res.status !== 200 || typeof res.data?.content !== "string")
    throw new Error(`read ${SOURCE}/${file} at ${sha.slice(0, 7)}: HTTP ${res.status}`);
  return Buffer.from(res.data.content, "base64").toString("utf8");
}

const encodePath = (file) => file.split("/").map(encodeURIComponent).join("/");

/** Reader for `renderFiles`: a file the manifest names must exist at the commit. */
const readAt = (sha) => (from) => {
  const text = readSource(from, sha);
  if (text === null) throw new Error(`${from} isn't in ${SOURCE} at ${sha.slice(0, 7)}`);
  return text;
};

/**
 * The manifest at the pinned commit, so the file list matches the files that exist there: an
 * older tag predates files the current manifest names (AI-408). The current one (shipped with
 * this CLI) only when the commit has none; any other read failure throws.
 */
export function manifestAt(sha, read = readSource, current = manifest) {
  const text = read(MANIFEST_PATH, sha);
  return text === null ? current() : JSON.parse(text);
}

/** Resolves a tag, branch (`origin/` optional) or SHA to a commit SHA on GitHub (pins must resolve). */
function resolveRef(ref) {
  const name = ref.replace(/^origin\//, "");
  const res = ghApi("GET", `repos/${SOURCE}/commits/${encodeURIComponent(name)}`);
  if (res.status !== 200 || !/^[0-9a-f]{40}$/.test(res.data?.sha ?? ""))
    throw new Error(
      `${ref} isn't a commit on GitHub ${SOURCE} (HTTP ${res.status}); push it first`,
    );
  return res.data.sha;
}

/** The newest `vX.Y.Z` tag name, or null. */
export function latestTag(names) {
  const parse = (n) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(n)?.slice(1).map(Number);
  const tags = names.map((n) => ({ n, v: parse(n) })).filter((t) => t.v);
  tags.sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);
  return tags[0]?.n ?? null;
}

/** --ref's default: the source's newest release tag. */
function defaultRef() {
  const res = ghApi("GET", `repos/${SOURCE}/tags?per_page=100`);
  if (res.status !== 200) throw new Error(`list ${SOURCE} tags: HTTP ${res.status}; pass --ref`);
  const tag = latestTag(res.data.map((t) => t.name));
  if (!tag) throw new Error(`${SOURCE} has no vX.Y.Z tag; pass --ref`);
  console.log(`--ref not given: using the newest baseline tag, ${tag}`);
  return tag;
}

/** `owner/repo` from a GitHub remote URL (https or ssh), or null. */
export function repoOfRemote(url) {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** <owner/repo>'s default: the current folder's `origin` remote. */
function defaultRepo() {
  const res = run("git", ["remote", "get-url", "origin"], { allowFail: true, env: cleanGitEnv() });
  const repo = res.status === 0 ? repoOfRemote(res.stdout) : null;
  if (!repo) throw new Error("no owner/repo given, and this folder has no GitHub `origin`");
  console.log(`owner/repo not given: using this folder's origin, ${repo}`);
  return repo;
}

/** Git identity for the baseline commit: the user's (here, else global), not the clone's. */
function gitIdentity() {
  const value = (key) =>
    run("git", ["config", key], { allowFail: true, env: cleanGitEnv() }).stdout.trim();
  return { "user.name": value("user.name"), "user.email": value("user.email") };
}

function readRemote(repo, file) {
  const res = ghApi("GET", `repos/${repo}/contents/${file}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`read ${repo}/${file}: HTTP ${res.status}`);
  return Buffer.from(res.data.content, "base64").toString("utf8");
}

/**
 * The deploy kind to render: the flag, else what the clone's `.andy/baseline.json` records, else
 * `none`. Andy's `gh` login can't read the control plane's project setting, so the flag carries it
 * (the App's baseline PR report prints it); the record keeps it for later runs and `check`.
 */
export function deployKindFor(flag, recordText) {
  if (flag) return checkDeployKind(flag);
  if (recordText === null || recordText === undefined) return "none";
  let record;
  try {
    record = JSON.parse(recordText);
  } catch {
    throw new Error(".andy/baseline.json isn't JSON; pass --deploy-kind");
  }
  return recordedDeployKind(record);
}

const readIfExists = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);

function writeFile(dir, file, content) {
  const target = path.join(dir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/**
 * Environment for commands in the cloned repo. Its git hooks (lefthook) call `pnpm`, so when pnpm
 * isn't installed, a shim that runs it through npx goes first on PATH. No `GIT_*` variables, so
 * running this from a git hook can't write to the hook's repository (AI-20).
 */
function repoEnv() {
  const found = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  if (!found.error && found.status === 0) return cleanGitEnv();
  const bin = mkdtempSync(path.join(tmpdir(), "pnpm-shim-"));
  writeFileSync(path.join(bin, "pnpm"), '#!/bin/sh\nexec npx -y pnpm@10.28.0 "$@"\n', {
    mode: 0o755,
  });
  console.log("pnpm not on PATH; using npx pnpm@10.28.0");
  return cleanGitEnv({ ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
}

/**
 * Clones the repo, writes the baseline files, and pushes (empty repo) or opens a PR. Returns
 * what happened: "pushed" (to main), "pr" (opened) or "unchanged" (already at this baseline).
 */
function filesCommand(repo, ref, kindFlag, environments = "prod-only") {
  const sha = resolveRef(ref);
  const m = manifestAt(sha);
  const dir = mkdtempSync(path.join(tmpdir(), "baseline-"));
  const env = repoEnv();
  run("gh", ["repo", "clone", repo, dir, "--", "--quiet"], { env });
  const deployKind = deployKindFor(kindFlag, readIfExists(path.join(dir, ".andy/baseline.json")));
  console.log(`${repo}: deploy kind ${deployKind}`);
  const rendered = renderFiles(m, readAt(sha), { sha, ref, deployKind, environments });
  const empty =
    run("git", ["-C", dir, "rev-parse", "--verify", "HEAD"], { allowFail: true, env }).status !== 0;
  const starter = !existsSync(path.join(dir, "package.json"));
  // Commit as the identity where this runs (e.g. a noreply address set in the folder), not the
  // clone's default: GitHub rejects pushes that would publish a private email.
  for (const [key, value] of Object.entries(gitIdentity()))
    if (value) run("git", ["-C", dir, "config", key, value], { env });

  for (const f of rendered.managed) writeFile(dir, f.path, f.content);
  for (const f of rendered.lines) {
    const target = path.join(dir, f.path);
    const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
    writeFile(dir, f.path, mergeLines(existing, f.lines));
  }
  const notes = [];
  for (const f of seedsToWrite(rendered.seed, (p) => existsSync(path.join(dir, p)))) {
    writeFile(dir, f.path, f.content);
    if (f.ownAppNote && !starter) notes.push(`- \`${f.path}\`: ${f.ownAppNote}`);
  }
  for (const n of notes) console.log(`${repo}: ${n.slice(2)}`);
  if (starter) for (const f of rendered.starter) writeFile(dir, f.path, f.content);
  const date = new Date().toISOString().slice(0, 10);
  writeFile(
    dir,
    ".andy/baseline.json",
    baselineRecord({ source: m.source, sha, ref, date, deployKind }),
  );
  // Creates pnpm-lock.yaml for a starter repo (CI installs with --frozen-lockfile) and installs hooks.
  if (existsSync(path.join(dir, "package.json")))
    run("pnpm", ["install"], { cwd: dir, stdio: "inherit", env });

  run("git", ["-C", dir, "add", "-A"], { env });
  if (
    run("git", ["-C", dir, "diff", "--cached", "--quiet"], { allowFail: true, env }).status === 0
  ) {
    console.log(`${repo}: files already match baseline ${ref} (${sha.slice(0, 7)})`);
    return "unchanged";
  }
  const message = `Project baseline ${ref} (${sha.slice(0, 7)})`;
  run("git", ["-C", dir, "commit", "-q", "-m", message], { stdio: "inherit", env });
  if (empty) {
    run("git", ["-C", dir, "push", "-q", "origin", "HEAD:main"], { stdio: "inherit", env });
    console.log(`${repo}: pushed ${message} to main (empty repo)`);
    return "pushed";
  }
  const branch = `baseline/${sha.slice(0, 7)}`;
  run("git", ["-C", dir, "push", "-q", "origin", `HEAD:refs/heads/${branch}`], {
    stdio: "inherit",
    env,
  });
  const body = `Brings this repo to the andy-intelligence project baseline at \`${ref}\` (${sha}). Generated by \`${CLI} files\`.${notes.length ? `\n\n**Before the first deploy:**\n${notes.join("\n")}` : ""}`;
  run(
    "gh",
    ["pr", "create", "--repo", repo, "--head", branch, "--title", message, "--body", body],
    { stdio: "inherit", env },
  );
  return "pr";
}

/**
 * Adds the files the App can't write (workflows, agent settings; `heldToAdd`) to the App's
 * baseline PR branch, with Andy's `gh` login: only the missing ones, so a differing file stays
 * for review (AI-113).
 */
function finishCommand(repo, ref, branch, kindFlag) {
  const sha = resolveRef(ref);
  const m = manifestAt(sha);
  const dir = mkdtempSync(path.join(tmpdir(), "baseline-finish-"));
  const env = repoEnv();
  run("gh", ["repo", "clone", repo, dir, "--", "--quiet", "--branch", branch], { env });
  const deployKind = deployKindFor(kindFlag, readIfExists(path.join(dir, ".andy/baseline.json")));
  console.log(`${repo}: deploy kind ${deployKind}`);
  const rendered = renderFiles(m, readAt(sha), { sha, ref, deployKind });
  for (const [key, value] of Object.entries(gitIdentity()))
    if (value) run("git", ["-C", dir, "config", key, value], { env });
  const added = [];
  for (const f of heldToAdd(rendered, (p) => existsSync(path.join(dir, p)))) {
    writeFile(dir, f.path, f.content);
    added.push(f.path);
  }
  if (added.length === 0) {
    console.log(`${repo}: ${branch} already has every workflow and agent settings file`);
    return;
  }
  run("git", ["-C", dir, "add", "--", ...added], { env });
  const message = `Project baseline: workflows and agent settings (${sha.slice(0, 7)})`;
  run("git", ["-C", dir, "commit", "-q", "-m", message], { stdio: "inherit", env });
  run("git", ["-C", dir, "push", "-q", "origin", `HEAD:refs/heads/${branch}`], {
    stdio: "inherit",
    env,
  });
  console.log(`${repo}: pushed ${added.length} files to ${branch}:\n  ${added.join("\n  ")}`);
}

function printSections(results) {
  for (const r of results) {
    console.log(`${r.section}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
    for (const d of r.diffs) {
      console.log(
        `  ${d.setting || "(whole)"}: want ${JSON.stringify(d.want)}, have ${JSON.stringify(d.have)}`,
      );
    }
  }
}

async function applyCommand(repo, dryRun) {
  const names = SECTIONS.map((s) => s.name);
  const config = configFor(loadConfig(), repo, manifest().source);
  if (dryRun) {
    const results = await checkSections(ghApi, repo, config, names);
    printSections(results);
    console.log("dry run: nothing changed");
    return 0;
  }
  const results = await applySections(ghApi, repo, config, names);
  printSections(results);
  return results.some((r) => r.status !== "ok") ? 1 : 0;
}

async function checkCommand(repo, only) {
  const names = only ?? ALL;
  let failed = false;
  const settings = names.filter((n) => n !== "files");
  if (settings.length > 0) {
    const results = await checkSections(
      ghApi,
      repo,
      configFor(loadConfig(), repo, manifest().source),
      settings,
    );
    printSections(results);
    failed = results.some((r) => r.status === "drift");
  }
  if (names.includes("files")) {
    const m = manifest();
    if (repo === m.source) {
      console.log("files: skipped (this repo is the baseline source)");
    } else {
      const record = readRemote(repo, ".andy/baseline.json");
      if (record === null) {
        console.log("files: drift\n  .andy/baseline.json: missing (repo not onboarded)");
        failed = true;
      } else {
        const { version, ref } = JSON.parse(record);
        const deployKind = deployKindFor(undefined, record);
        const rendered = renderFiles(manifestAt(version), readAt(version), {
          sha: version,
          ref,
          deployKind,
        });
        const drift = fileDrift(rendered, (f) => readRemote(repo, f), {
          source: m.source,
          version,
        });
        console.log(
          `files: ${drift.length ? "drift" : "ok"} (baseline ${ref}, ${version.slice(0, 7)}, deploy kind ${deployKind})`,
        );
        for (const d of drift) console.log(`  ${d.path}: ${d.issue}`);
        failed ||= drift.length > 0;
      }
    }
  }
  return failed ? 1 : 0;
}

/** Parses argv into { command, repo, ref, branch, dryRun, only, deployKind, environments }. */
export function parseArgs(argv) {
  const [command, ...args] = argv;
  const repo = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const rest = repo ? args.slice(1) : args;
  const opts = {
    command,
    repo,
    ref: undefined,
    branch: undefined,
    dryRun: false,
    only: undefined,
    deployKind: undefined,
    environments: undefined,
  };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--ref") opts.ref = rest[++i];
    else if (rest[i] === "--branch") opts.branch = rest[++i];
    else if (rest[i] === "--dry-run") opts.dryRun = true;
    else if (rest[i] === "--only") opts.only = rest[++i].split(",");
    else if (rest[i] === "--deploy-kind") opts.deployKind = checkDeployKind(rest[++i]);
    else if (rest[i] === "--environments") opts.environments = checkEnvironments(rest[++i]);
    else throw new Error(`unknown option ${rest[i]}`);
  }
  if (!["onboard", "files", "apply", "check", "finish"].includes(command))
    throw new Error(`unknown command ${command}`);
  if (repo !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error("repo must be owner/name");
  if (command === "finish" && !opts.ref) throw new Error("finish needs --ref <sha>");
  if (command === "finish" && !/^baseline\/[a-z0-9-]{1,60}$/.test(opts.branch ?? ""))
    throw new Error("finish needs --branch baseline/<name> (the App's baseline PR branch)");
  if (opts.deployKind && !["onboard", "files", "finish"].includes(command))
    throw new Error(`${command} takes no --deploy-kind (it reads .andy/baseline.json)`);
  if (opts.environments && !["onboard", "files"].includes(command))
    throw new Error(`${command} takes no --environments (only onboard and files seed infra/)`);
  const unknown = (opts.only ?? []).filter((n) => !ALL.includes(n));
  if (unknown.length > 0) throw new Error(`unknown --only section(s): ${unknown.join(", ")}`);
  return opts;
}

/**
 * What Andy does after `onboard`, by what `files` did: "pr" (an existing repo: settings wait for
 * the merge, since the ruleset requires checks that must exist on main first), else the settings
 * are applied already (a new or up-to-date repo).
 */
export function nextSteps(outcome, repo) {
  const steps =
    outcome === "pr"
      ? [
          "Review and merge the baseline PR (an existing repo needs `pnpm lint/typecheck/test/build` scripts, `.nvmrc`, and `lefthook` as a dev dependency).",
          `After it merges, apply the GitHub settings: \`${CLI} apply ${repo} --dry-run\`, then \`${CLI} apply ${repo}\`.`,
        ]
      : ["Open a first PR so every check runs once."];
  return [
    "Next:",
    ...[
      ...steps,
      `Reviewer token (never paste it anywhere): \`claude setup-token\`, then \`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${repo}\`.`,
      `\`${CLI} check ${repo}\` exits 0.`,
    ].map((s, i) => `  ${i + 1}. ${s}`),
  ].join("\n");
}

async function main(argv) {
  const o = parseArgs(argv);
  const repo = o.repo ?? defaultRepo();
  const ref = () => o.ref ?? defaultRef();
  if (o.command === "files") {
    filesCommand(repo, ref(), o.deployKind, o.environments);
    return 0;
  }
  if (o.command === "apply") return applyCommand(repo, o.dryRun);
  if (o.command === "check") return checkCommand(repo, o.only);
  if (o.command === "finish") {
    finishCommand(repo, o.ref, o.branch, o.deployKind);
    return 0;
  }
  const outcome = filesCommand(repo, ref(), o.deployKind, o.environments);
  if (outcome === "pr") {
    console.log(nextSteps(outcome, repo));
    return 0;
  }
  const status = await applyCommand(repo, false);
  if (status !== 0) console.log("apply left drift; see above");
  console.log(nextSteps(outcome, repo));
  return status;
}

// Through `npx`, argv[1] is the bin symlink, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e) => {
      console.error(e.message);
      process.exitCode = 2;
    },
  );
}
