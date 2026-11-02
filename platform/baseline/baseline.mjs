#!/usr/bin/env node
// Project baseline CLI (ADR-0031, ADR-0038). Runs on Andy's machine with his `gh` login (admin);
// never in CI except `check --only labels,ruleset` in the system security review.
// Runbook: docs/runbooks/onboard-a-repo.md.
//
//   baseline.mjs onboard <owner/repo> --ref <tag|branch|sha>   files + apply
//   baseline.mjs files   <owner/repo> --ref <tag|branch|sha>   write baseline files (push or PR)
//   baseline.mjs apply   <owner/repo> [--dry-run]              GitHub config
//   baseline.mjs check   <owner/repo> [--only a,b]             drift report; exit 1 on drift
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySections, checkSections, SECTIONS } from "./github.mjs";
import { baselineRecord, fileDrift, mergeLines, renderFiles } from "./files.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(HERE, "../..");
const ALL = [...SECTIONS.map((s) => s.name), "files"];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}):\n${r.stderr}${r.stdout}`);
  }
  return r;
}

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
  const read = (f) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  return {
    repo: read("repo.json"),
    security: read("security.json"),
    actions: read("actions.json"),
    labels: read("labels.json"),
    ruleset: read("ruleset-main.json"),
  };
}

const manifest = () => JSON.parse(readFileSync(path.join(HERE, "manifest.json"), "utf8"));

/** Resolves a ref in this checkout to a commit that also exists on GitHub (pins must resolve). */
function resolveRef(ref, source) {
  const sha = run("git", [
    "-C",
    SOURCE_ROOT,
    "rev-parse",
    "--verify",
    `${ref}^{commit}`,
  ]).stdout.trim();
  const res = ghApi("GET", `repos/${source}/commits/${sha}`);
  if (res.status !== 200)
    throw new Error(`${sha} (${ref}) isn't on GitHub ${source}; push it first`);
  return sha;
}

const readAt = (sha) => (from) => run("git", ["-C", SOURCE_ROOT, "show", `${sha}:${from}`]).stdout;

function readRemote(repo, file) {
  const res = ghApi("GET", `repos/${repo}/contents/${file}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`read ${repo}/${file}: HTTP ${res.status}`);
  return Buffer.from(res.data.content, "base64").toString("utf8");
}

function writeFile(dir, file, content) {
  const target = path.join(dir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function pnpm(args, cwd) {
  const direct = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  if (!direct.error && direct.status === 0) return run("pnpm", args, { cwd, stdio: "inherit" });
  return run("npx", ["-y", "pnpm@10.28.0", ...args], { cwd, stdio: "inherit" });
}

/** Clones the repo, writes the baseline files, and pushes (empty repo) or opens a PR. */
function filesCommand(repo, ref) {
  const m = manifest();
  const sha = resolveRef(ref, m.source);
  const rendered = renderFiles(m, readAt(sha), { sha, ref });
  const dir = mkdtempSync(path.join(tmpdir(), "baseline-"));
  run("gh", ["repo", "clone", repo, dir, "--", "--quiet"]);
  const empty =
    run("git", ["-C", dir, "rev-parse", "--verify", "HEAD"], { allowFail: true }).status !== 0;
  const starter = !existsSync(path.join(dir, "package.json"));

  for (const f of rendered.managed) writeFile(dir, f.path, f.content);
  for (const f of rendered.lines) {
    const target = path.join(dir, f.path);
    const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
    writeFile(dir, f.path, mergeLines(existing, f.lines));
  }
  for (const f of rendered.seed)
    if (!existsSync(path.join(dir, f.path))) writeFile(dir, f.path, f.content);
  if (starter) for (const f of rendered.starter) writeFile(dir, f.path, f.content);
  const date = new Date().toISOString().slice(0, 10);
  writeFile(dir, ".andy/baseline.json", baselineRecord({ source: m.source, sha, ref, date }));
  // Creates pnpm-lock.yaml for a starter repo (CI installs with --frozen-lockfile) and installs hooks.
  if (existsSync(path.join(dir, "package.json"))) pnpm(["install"], dir);

  run("git", ["-C", dir, "add", "-A"]);
  if (run("git", ["-C", dir, "diff", "--cached", "--quiet"], { allowFail: true }).status === 0) {
    console.log(`${repo}: files already match baseline ${ref} (${sha.slice(0, 7)})`);
    return;
  }
  const message = `Project baseline ${ref} (${sha.slice(0, 7)})`;
  run("git", ["-C", dir, "commit", "-q", "-m", message], { stdio: "inherit" });
  if (empty) {
    run("git", ["-C", dir, "push", "-q", "origin", "HEAD:main"], { stdio: "inherit" });
    console.log(`${repo}: pushed ${message} to main (empty repo)`);
    return;
  }
  const branch = `baseline/${sha.slice(0, 7)}`;
  run("git", ["-C", dir, "push", "-q", "origin", `HEAD:refs/heads/${branch}`], {
    stdio: "inherit",
  });
  const body = `Brings this repo to the andy-intelligence project baseline at \`${ref}\` (${sha}). Generated by \`platform/baseline/baseline.mjs files\`.`;
  run(
    "gh",
    ["pr", "create", "--repo", repo, "--head", branch, "--title", message, "--body", body],
    {
      stdio: "inherit",
    },
  );
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
  const config = loadConfig();
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
    const results = await checkSections(ghApi, repo, loadConfig(), settings);
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
        const rendered = renderFiles(m, readAt(version), { sha: version, ref });
        const drift = fileDrift(rendered, (f) => readRemote(repo, f), {
          source: m.source,
          version,
        });
        console.log(
          `files: ${drift.length ? "drift" : "ok"} (baseline ${ref}, ${version.slice(0, 7)})`,
        );
        for (const d of drift) console.log(`  ${d.path}: ${d.issue}`);
        failed ||= drift.length > 0;
      }
    }
  }
  return failed ? 1 : 0;
}

/** Parses argv into { command, repo, ref, dryRun, only }. */
export function parseArgs(argv) {
  const [command, repo, ...rest] = argv;
  const opts = { command, repo, ref: undefined, dryRun: false, only: undefined };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--ref") opts.ref = rest[++i];
    else if (rest[i] === "--dry-run") opts.dryRun = true;
    else if (rest[i] === "--only") opts.only = rest[++i].split(",");
    else throw new Error(`unknown option ${rest[i]}`);
  }
  if (!["onboard", "files", "apply", "check"].includes(command))
    throw new Error(`unknown command ${command}`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new Error("repo must be owner/name");
  if ((command === "onboard" || command === "files") && !opts.ref)
    throw new Error(`${command} needs --ref`);
  const unknown = (opts.only ?? []).filter((n) => !ALL.includes(n));
  if (unknown.length > 0) throw new Error(`unknown --only section(s): ${unknown.join(", ")}`);
  return opts;
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.command === "files") {
    filesCommand(o.repo, o.ref);
    return 0;
  }
  if (o.command === "apply") return applyCommand(o.repo, o.dryRun);
  if (o.command === "check") return checkCommand(o.repo, o.only);
  filesCommand(o.repo, o.ref);
  const status = await applyCommand(o.repo, false);
  console.log(
    status === 0 ? "onboarded; run `check` to confirm no drift" : "apply left drift; see above",
  );
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e) => {
      console.error(e.message);
      process.exitCode = 2;
    },
  );
}
