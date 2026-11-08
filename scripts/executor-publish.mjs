#!/usr/bin/env node
// Executor publish (ADR-0063): the build run's `publish` job runs this from the platform's own
// checkout (never the project's). In the project checkout at the agent's base commit it applies
// the agent's patch, refuses protected paths, commits, gets the run's one repo token, pushes
// `agent/<KEY>/<run>` and opens the PR. The patch, the agent's report and the ticket title are
// untrusted: they go to git and GitHub only as arguments, files or JSON bodies, never through a
// shell, and are never printed. The token is masked, kept in memory and passed to git through
// GIT_CONFIG_* env (not argv).
//
// Usage: executor-publish.mjs publish | drop-placeholders
//   drop-placeholders (agent job, before the change is collected): env WORKSPACE, MANIFEST.
//   publish env: PATCH, PROFILE, CODEOWNERS (path or empty), RUN_ID, BRANCH, REPO, BASE, PROJECT_ID,
//   TICKET_KEY, TICKET_TITLE, MODEL, REPORT (the agent's report JSON), CONTROL_PLANE_URL,
//   ACTIONS_ID_TOKEN_REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN, GITHUB_OUTPUT.
//   Writes outputs `branch`, `tooling_files` (JSON array) and, when a PR opened, `pull_request`.
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codeownersPatterns } from "./executor-profile.mjs";

/** Caps on one build run's change (ADR-0028). */
export const MAX_CHANGED_FILES = 200;
/** GitHub rejects descriptions over 65,536 characters. */
export const MAX_BODY = 60000;

/**
 * Protected path globs (repo-relative): every any-depth Edit deny of the profile (rules like Edit of //, two stars, /x), and every
 * CODEOWNERS pattern after the catch-all `*` line (ARCHITECTURE §4.5: paths listed after `*` are
 * the protected ones; `*` itself only requests Andy's review).
 */
export function protectedGlobs(profile, codeowners) {
  const fromProfile = profile.settings.permissions.deny
    .map((rule) => /^Edit\(\/\/\*\*\/(.+)\)$/.exec(rule)?.[1])
    .filter((p) => p !== undefined)
    .map((p) => `**/${p}`);
  const fromOwners = codeownersPatterns(codeowners)
    .filter((p) => !["*", "/*", "**", "/**"].includes(p))
    .flatMap((p) => {
      const dir = p.endsWith("/");
      const body = p.replace(/^\/+|\/+$/g, "");
      const anchored = p.replace(/\/+$/, "").includes("/");
      const glob = anchored ? body : `**/${body}`;
      return dir || glob.endsWith("/**")
        ? [`${glob.replace(/\/\*\*$/, "")}/**`]
        : [glob, `${glob}/**`];
    });
  return [...new Set([...fromProfile, ...fromOwners])];
}

/** A gitignore-style glob as a regex over repo-relative paths: double-star slash = any dirs, `*` within one. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (glob.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      re += ".*";
      i += 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Entries of `git diff --raw -z --no-renames`: { srcMode, dstMode, status, path }. */
export function parseRaw(text) {
  const parts = text.split("\0").filter((p) => p !== "");
  const entries = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [srcMode, dstMode, , , status] = parts[i].replace(/^:/, "").split(" ");
    entries.push({ srcMode, dstMode, status, path: parts[i + 1] });
  }
  return entries;
}

/** Reasons the change can't be pushed; empty when it can. */
export function checkChange(entries, globs) {
  const reasons = [];
  if (entries.length === 0) reasons.push("the change is empty");
  if (entries.length > MAX_CHANGED_FILES) {
    reasons.push(`${entries.length} files changed; the cap is ${MAX_CHANGED_FILES}`);
  }
  const patterns = globs.map((g) => [g, globToRegExp(g)]);
  for (const e of entries) {
    if (e.dstMode === "120000" || e.srcMode === "120000") reasons.push(`${e.path}: a symlink`);
    if (e.dstMode === "160000" || e.srcMode === "160000") reasons.push(`${e.path}: a submodule`);
    const hit = patterns.find(([, re]) => re.test(e.path));
    if (hit) reasons.push(`${e.path}: protected (${hit[0]})`);
  }
  return reasons;
}

/** Zero-width space: breaks @-mentions and code fences without changing how text reads. */
const ZWSP = "\u200b";

/** Untrusted text made safe to paste into markdown: no @-mentions, no fence breaks. */
export function neutralize(text) {
  return String(text)
    .replace(/@(?=[A-Za-z0-9])/g, `@${ZWSP}`)
    .replace(/`{3,}|~{3,}/g, (m) => m.split("").join(ZWSP));
}

const list = (items) =>
  items.length === 0 ? "None." : items.map((i) => `- ${neutralize(i)}`).join("\n");

/**
 * Tooling and dependency files: they run in CI and on Andy's machine when he checks out the
 * branch. Allowed, but flagged on the PR and the Run. The gate treats them as protected paths and
 * keeps its own copy (`TOOLING_GLOBS` in packages/domain/src/gate.ts): a test holds the two equal.
 */
export const TOOLING_GLOBS = [
  "**/package.json",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/.npmrc",
  "**/.yarnrc*",
  "**/pnpm-workspace.yaml",
  "**/lefthook.yml",
  "**/.lefthook.yml",
  "**/.gitattributes",
  "**/.nvmrc",
  "**/.node-version",
  "**/tsconfig*.json",
  "**/*.config.{js,cjs,mjs,ts,cts,mts,json}",
  "**/.prettierrc*",
  "**/.eslintrc*",
  "**/Makefile",
  "**/Dockerfile",
];

/** The changed paths that are tooling or dependency files. */
export function toolingFiles(entries) {
  const patterns = TOOLING_GLOBS.flatMap(expandBraces).map(globToRegExp);
  return entries.map((e) => e.path).filter((p) => patterns.some((re) => re.test(p)));
}

function expandBraces(glob) {
  const m = /^(.*)\{([^}]+)\}(.*)$/.exec(glob);
  return m ? m[2].split(",").map((alt) => `${m[1]}${alt}${m[3]}`) : [glob];
}

/**
 * Files Claude Code's sandbox write-protects in the checkout (AI-42, ADR-0071). On Linux it holds a
 * denial on a missing file by binding a 0-byte read-only placeholder there and is meant to remove
 * it afterwards; the 2026-11-06 proof left the first seven behind. The rest are the documented
 * protected files (code.claude.com/docs/en/sandboxing#protected-paths). Repo-relative.
 */
export const SANDBOX_PLACEHOLDERS = [
  ".gitmodules",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  "bunfig.toml",
  "package-lock.json",
  "yarn.lock",
  ".gitconfig",
  ".bashrc",
  ".bash_profile",
  ".zshrc",
  ".zprofile",
  ".profile",
  ".ripgreprc",
  ".mcp.json",
  ".claude/settings.json",
  ".claude/settings.local.json",
];

/**
 * The sandbox placeholders to drop before the change is collected: listed paths that are empty
 * regular files and weren't in the workspace before the agent. `stat(path)` returns
 * `{ file, size }` or null; `before` is the set of paths that existed before the agent.
 */
export function sandboxPlaceholders({ before, stat }) {
  return SANDBOX_PLACEHOLDERS.filter((path) => {
    if (before.has(path)) return false;
    const s = stat(path);
    return s !== null && s.file && s.size === 0;
  }).sort();
}

/**
 * Deletes the sandbox placeholders from the (hostile) checkout `root` and logs each one.
 * `manifest` is the NUL-separated file list taken before the agent ran; without it nothing is
 * dropped and this throws, so the step fails rather than guess. Symlinks and paths below a
 * symlinked directory are never followed or deleted.
 */
export function dropSandboxPlaceholders({ root, manifest, emit }) {
  let listed;
  try {
    listed = readFileSync(manifest, "utf8");
  } catch (err) {
    throw new Error(`No pre-agent workspace manifest at ${manifest}: ${err.message}`, {
      cause: err,
    });
  }
  const before = new Set(listed.split("\0").filter((p) => p !== ""));
  const base = realpathSync(root);
  const stat = (path) => {
    const abs = join(base, path);
    try {
      if (realpathSync(dirname(abs)) !== resolve(base, dirname(path))) return null;
      const s = lstatSync(abs);
      return { file: s.isFile(), size: s.size };
    } catch {
      return null;
    }
  };
  const dropped = sandboxPlaceholders({ before, stat });
  for (const path of dropped) {
    unlinkSync(join(base, path));
    emit(`Dropped sandbox placeholder ${path} (empty, not there before the agent).`);
  }
  return dropped;
}

const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Whether the agent's output has the shape the description needs. The action already enforces
 * the schema; this keeps a malformed one from crashing the job after the push.
 */
function hasBuildShape(o) {
  const p = o?.plan;
  return (
    typeof o?.summary === "string" &&
    p !== null &&
    typeof p === "object" &&
    strings(p.files) &&
    strings(p.steps) &&
    strings(p.tests) &&
    typeof p.riskiestStep === "string" &&
    strings(p.rejectedAlternatives) &&
    strings(o.deviations) &&
    strings(o.failingTestFiles) &&
    Array.isArray(o.verification) &&
    o.verification.every(
      (c) =>
        typeof c?.command === "string" &&
        typeof c.passed === "boolean" &&
        typeof c.output === "string",
    )
  );
}

/** The PR title and description: the ticket link first, then the structured summary (§4.1). */
export function pullRequest({
  controlPlaneUrl,
  projectId,
  ticketKey,
  ticketTitle,
  runId,
  model,
  report,
  tooling = [],
}) {
  const title = `${ticketKey}: ${ticketTitle}`.replace(/[\r\n]+/g, " ").slice(0, 250);
  const output = hasBuildShape(report?.output) ? report.output : null;
  const lines = [
    // First line: the ticket link, which moves the ticket on PR events (ADR-0056).
    `${controlPlaneUrl}/p/${projectId}/t/${ticketKey}`,
    "",
    ...(tooling.length > 0
      ? [
          `> **Changes tooling or dependency files: review before running this branch locally.** ${tooling
            .slice(0, 10)
            .map((f) => `\`${neutralize(f).replace(/`/g, "'")}\``)
            .join(", ")}${tooling.length > 10 ? ", …" : ""}`,
          "",
        ]
      : []),
    `**Ticket:** ${ticketKey} · **Run:** \`${runId}\` · **Model:** ${model} · **Opened by** the build run (ADR-0063); agent text below is untrusted.`,
    "",
    "## Summary",
    "",
    neutralize(output?.summary ?? report?.summary ?? "The run gave no summary."),
  ];
  if (output) {
    const p = output.plan;
    lines.push(
      "",
      "## Plan",
      "",
      "**Files**",
      list(p.files),
      "",
      "**Order of work**",
      p.steps.map((s, i) => `${i + 1}. ${neutralize(s)}`).join("\n"),
      "",
      "**Tests**",
      list(p.tests),
      "",
      `**Riskiest step:** ${neutralize(p.riskiestStep)}`,
      "",
      "**Rejected alternatives**",
      list(p.rejectedAlternatives),
      "",
      "## Deviations from the plan",
      "",
      list(output.deviations),
      "",
      "## Verification",
      "",
      ...output.verification.flatMap((c) => [
        `- \`${neutralize(c.command).replace(/`/g, "'")}\`: ${c.passed ? "passed" : "**failed**"}`,
        ...(c.output
          ? ["", "  ````text", neutralize(c.output).replace(/^/gm, "  "), "  ````", ""]
          : []),
      ]),
    );
    if (output.failingTestFiles.length > 0) {
      lines.push("", "## Failing test first (bug)", "", list(output.failingTestFiles));
    }
  } else {
    lines.push("", "## Verification", "", "None: the run returned no structured result.");
  }
  let body = lines.join("\n");
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY - 40)}\n\n…(cut to the size limit)`;
  return { title, body };
}

const BRANCH = /^agent\/[A-Z][A-Z0-9]{0,9}-[0-9]{1,9}\/[A-Za-z0-9-]{1,64}$/;
const RUN_ID = /^[A-Za-z0-9-]{1,64}$/;
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/**
 * A log-safe line: reasons can hold agent-chosen paths, which may contain newlines; a newline
 * followed by `::` would be read as a workflow command.
 */
export function oneLine(text) {
  return String(text)
    .replace(/[\r\n]+/g, " ")
    .replace(/::/g, ": :")
    .slice(0, 500);
}

/** A refusal: the reasons go to the job log as errors; nothing is pushed. */
export class PublishRefused extends Error {
  constructor(reasons) {
    super(reasons.join("; "));
    this.reasons = reasons;
  }
}

/**
 * A failed git call, reported by subcommand, exit code and git's stderr only: the argument list
 * holds the commit message (`KEY: title`) and paths, which are never printed.
 */
export class GitError extends Error {
  constructor(subcommand, status, stderr) {
    super(
      `git ${subcommand} failed (exit ${status ?? "?"}): ${String(stderr ?? "")
        .trim()
        .slice(0, 300)}`,
    );
    this.name = "GitError";
  }
}

/** The git subcommand of an argument list (skipping leading `--global-options`). */
function subcommandOf(args) {
  return args.find((a) => !a.startsWith("-")) ?? "?";
}

/** git, run without a shell; returns stdout. `extraEnv` carries the push credential. */
export function gitRunner(cwd) {
  return (args, extraEnv = {}) => {
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          ...extraEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      // execFileSync's own message repeats the full command line: never pass it on.
      throw new GitError(subcommandOf(args), err?.status, err?.stderr);
    }
  };
}

async function json(res, what) {
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300).replace(/[\r\n]+/g, " ");
    throw new Error(`${what} returned HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * The whole publish job. `git` and `fetch` are injectable for tests; `emit` writes a workflow
 * command or log line; `output` a step output.
 */
export async function publish({ env, git, fetch: fetchImpl = globalThis.fetch, emit, output }) {
  const reasons = [];
  if (!BRANCH.test(env.BRANCH ?? "")) reasons.push("unexpected branch name");
  if (!RUN_ID.test(env.RUN_ID ?? "")) reasons.push("unexpected run id");
  if (!REPO.test(env.REPO ?? "")) reasons.push("unexpected repository");
  if (reasons.length > 0) throw new PublishRefused(reasons);
  let report;
  try {
    report = JSON.parse(env.REPORT ?? "null");
  } catch {
    report = null;
  }

  git(["config", "user.name", "andy-intelligence-control[bot]"]);
  git(["config", "user.email", "andy-intelligence-control[bot]@users.noreply.github.com"]);
  git(["apply", "--index", "--binary", env.PATCH]);
  const entries = parseRaw(git(["diff", "--cached", "--raw", "-z", "--no-renames"]));
  const profile = JSON.parse(readFileSync(env.PROFILE, "utf8"));
  let owners;
  try {
    owners = env.CODEOWNERS ? readFileSync(env.CODEOWNERS, "utf8") : "";
  } catch {
    owners = "";
  }
  const refused = checkChange(entries, protectedGlobs(profile, owners));
  if (refused.length > 0) throw new PublishRefused(refused);
  const tooling = toolingFiles(entries);

  const message = `${env.TICKET_KEY}: ${env.TICKET_TITLE}`.replace(/[\r\n]+/g, " ").slice(0, 250);
  const trailer = `Agent-Run: ${env.RUN_ID}`;
  const tests = Array.isArray(report?.output?.failingTestFiles)
    ? report.output.failingTestFiles.filter((f) => typeof f === "string" && f !== "")
    : [];
  const staged = () => git(["diff", "--cached", "--name-only"]).trim() !== "";
  if (tests.length > 0) {
    // Bug tickets: the failing test in its own commit first. Literal: no pathspec magic.
    git(["reset", "-q"]);
    try {
      git(["--literal-pathspecs", "add", "--", ...tests]);
    } catch {
      emit("Some failingTestFiles aren't in the change; committing what is.");
    }
    if (staged()) git(["commit", "-q", "-m", `${message}: failing test`, "-m", trailer]);
    git(["add", "-A"]);
  }
  if (staged()) git(["commit", "-q", "-m", message, "-m", trailer]);

  const audience = encodeURIComponent(env.CONTROL_PLANE_URL);
  const oidc = (
    await json(
      await fetchImpl(`${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${audience}`, {
        headers: { authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
      }),
      "the Actions OIDC token request",
    )
  ).value;
  emit(`::add-mask::${oidc}`);
  const { token } = await json(
    await fetchImpl(`${env.CONTROL_PLANE_URL}/github/token`, {
      method: "POST",
      headers: { authorization: `Bearer ${oidc}`, "content-type": "application/json" },
      body: JSON.stringify({ runId: env.RUN_ID }),
    }),
    "POST /github/token",
  );
  if (typeof token !== "string" || token === "")
    throw new Error("POST /github/token gave no token");
  emit(`::add-mask::${token}`);
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  emit(`::add-mask::${basic}`);
  git(["push", "--quiet", `https://github.com/${env.REPO}.git`, `HEAD:refs/heads/${env.BRANCH}`], {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  });
  output("branch", env.BRANCH);
  output("tooling_files", JSON.stringify(tooling));
  emit(`Pushed ${env.BRANCH}.`);

  if (report?.status !== "succeeded") {
    emit("The agent failed: branch kept for Andy, no pull request.");
    return { branch: env.BRANCH, pullRequest: null, tooling };
  }
  const pr = pullRequest({
    controlPlaneUrl: env.CONTROL_PLANE_URL,
    projectId: env.PROJECT_ID,
    ticketKey: env.TICKET_KEY,
    ticketTitle: env.TICKET_TITLE,
    runId: env.RUN_ID,
    model: env.MODEL,
    report,
    tooling,
  });
  const opened = await json(
    await fetchImpl(`https://api.github.com/repos/${env.REPO}/pulls`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...pr, head: env.BRANCH, base: env.BASE }),
    }),
    "opening the pull request",
  );
  const url = typeof opened?.html_url === "string" ? opened.html_url : null;
  if (url) output("pull_request", url);
  emit(`Opened ${url ?? "a pull request"}.`);
  return { branch: env.BRANCH, pullRequest: url, tooling };
}

async function main() {
  const [command] = process.argv.slice(2);
  const env = process.env;
  if (command === "drop-placeholders") {
    // The agent job's collect step, before `git add -A` (env WORKSPACE, MANIFEST).
    try {
      dropSandboxPlaceholders({
        root: env.WORKSPACE,
        manifest: env.MANIFEST,
        emit: (line) => process.stdout.write(`${line}\n`),
      });
    } catch (err) {
      process.stdout.write(`::error title=claude-executor::${oneLine(err.message)}\n`);
      process.exitCode = 1;
    }
    return;
  }
  if (command !== "publish") {
    throw new Error("usage: executor-publish.mjs publish | drop-placeholders");
  }
  try {
    await publish({
      env,
      git: gitRunner(process.cwd()),
      emit: (line) => process.stdout.write(`${line}\n`),
      output: (name, value) => appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`),
    });
  } catch (err) {
    const reasons = err instanceof PublishRefused ? err.reasons : [err.message];
    for (const r of reasons) process.stdout.write(`::error title=claude-executor::${oneLine(r)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
