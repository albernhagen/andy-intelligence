import { execFile } from "node:child_process";
import type { Confinement } from "./seatbelt";

/**
 * A local build's publish (ADR-0089 slice 6): the platform's own `scripts/executor-publish.mjs`
 * from the platform checkout, the exact `publish()` the Actions executor's publish job runs
 * (path rules, protected paths, size and file caps, `agent/<KEY>/<runId>` branch, PR as the App
 * bot), in a child process under the runner's Seatbelt profile: network on (git push, the PR),
 * no Keychain, reads only the two checkouts and the patch.
 *
 * The script gets its push token from an Actions OIDC exchange. The harness below answers that
 * exchange in memory with the token the runner already holds, so the script runs unchanged and
 * the child never sees the runner secret or the per-run token. The token reaches the child on
 * stdin only, never into any process's environment (git gets it through a file, see the
 * harness), and the child's answer never holds it: the script's `::add-mask::` lines are dropped
 * and any other line has the token removed.
 */

export interface PublishInput {
  platformDir: string;
  /** A fresh worktree of the project at the agent's base commit (not the agent's checkout). */
  publishDir: string;
  patchPath: string;
  runId: string;
  branch: string;
  repo: string;
  /** The default branch name, the PR's base. */
  base: string;
  projectId: string;
  ticketKey: string;
  ticketTitle: string;
  model: string;
  /** The agent's report (status, summary, output): the PR description is built from it. */
  report: unknown;
  /** The control plane's origin: the ticket link on the PR's first line. */
  controlPlaneOrigin: string;
  pushToken: string;
  /** A directory only the publish child can read: git's credential file lives there briefly. */
  credDir: string;
  /** Where git pushes and the GitHub API; tests point them at local fakes. */
  gitBase: string;
  githubApi: string;
  confinement: Confinement;
  profilePath: string;
  timeoutMs?: number;
}

export type PublishResult =
  | { kind: "published"; branch: string; pullRequest: string | null; tooling: string[] }
  /** The publish checks refused the change (protected path, caps, symlink…): nothing pushed. */
  | { kind: "refused"; reasons: string[] }
  | { kind: "error"; reason: string };

/** Runs in the child: imports the platform's publish script by path, answers on stdout. */
const HARNESS = `
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.argv.at(-1);
const req = JSON.parse(readFileSync(0, "utf8"));
const token = req.pushToken;
delete req.pushToken;
const encodedToken = Buffer.from("x-access-token:" + token).toString("base64");
const scrub = (text) => String(text).split(token).join("***").split(encodedToken).join("***");
const { publish, gitRunner, PublishRefused } = await import(
  pathToFileURL(join(root, "scripts", "executor-publish.mjs")).href
);
const OIDC = "https://local-runner.invalid/oidc?run=" + encodeURIComponent(req.env.RUN_ID);
const env = { ...req.env, ACTIONS_ID_TOKEN_REQUEST_URL: OIDC, ACTIONS_ID_TOKEN_REQUEST_TOKEN: "local-runner" };
const owners = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"].find((f) => existsSync(join(process.cwd(), f)));
env.CODEOWNERS = owners ?? "";
env.PROFILE = join(root, "platform", "executor", "profile.json");
const GITHUB_API = "https://api.github.com/";
const fetchShim = async (url, init) => {
  const u = String(url);
  if (u.startsWith(OIDC + "&")) return Response.json({ value: "local-runner" });
  if (u === env.CONTROL_PLANE_URL + "/github/token") return Response.json({ token });
  if (u.startsWith(GITHUB_API)) return fetch(req.githubApi + "/" + u.slice(GITHUB_API.length), { ...init, redirect: "error" });
  throw new Error("the publish script asked for an unexpected URL");
};
const base = gitRunner(process.cwd());
const HEADER_KEY = "http.https://github.com/.extraheader";
const git = (args, extraEnv = {}) => {
  if (args.includes("push") && req.gitBase !== "https://github.com") {
    args = args.map((a) => (a.startsWith("https://github.com/") ? req.gitBase + a.slice(18) : a));
  }
  // The script hands git the push credential in its environment, which another process of the
  // same user can read. Here it goes in a mode-600 file only this child can read instead; git
  // gets the file's path (include.path) and nothing else.
  if (extraEnv.GIT_CONFIG_KEY_0 === HEADER_KEY && extraEnv.GIT_CONFIG_COUNT === "1") {
    const file = join(req.credDir, "push.gitconfig");
    writeFileSync(file, '[http "https://github.com/"]\\n\\textraheader = ' + extraEnv.GIT_CONFIG_VALUE_0 + "\\n", { mode: 0o600 });
    try {
      return base(args, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "include.path", GIT_CONFIG_VALUE_0: file });
    } finally {
      rmSync(file, { force: true });
    }
  }
  const encoded = Buffer.from("x-access-token:" + token).toString("base64");
  const text = JSON.stringify(extraEnv);
  if (text.includes(token) || text.includes(encoded)) throw new Error("refusing to put the push token in git's environment");
  return base(args, extraEnv);
};
const log = [];
const outputs = {};
let out;
try {
  const result = await publish({
    env,
    git,
    fetch: fetchShim,
    emit: (line) => { if (!String(line).startsWith("::add-mask::")) log.push(scrub(line).slice(0, 500)); },
    output: (name, value) => { outputs[name] = scrub(value); },
  });
  out = { kind: "published", branch: result.branch, pullRequest: result.pullRequest ?? null, tooling: result.tooling ?? [], log };
} catch (err) {
  out = err instanceof PublishRefused
    ? { kind: "refused", reasons: err.reasons.map((r) => scrub(r).slice(0, 300)), log }
    : { kind: "error", reason: scrub(err && err.message ? err.message : err).slice(0, 500), log };
}
process.stdout.write(JSON.stringify(out));
`;

export interface PublishOutcome {
  result: PublishResult;
  /** The script's own lines (no token): for the runner's log. */
  log: string[];
}

/** Runs the publish child and checks its answer. Never throws for a publish failure. */
export function publishChange(input: PublishInput): Promise<PublishOutcome> {
  if (!/^\S{8,}$/.test(input.pushToken)) {
    return Promise.resolve({
      result: { kind: "error", reason: "the push token has an unexpected shape" },
      log: [],
    });
  }
  const request = {
    pushToken: input.pushToken,
    credDir: input.credDir,
    gitBase: input.gitBase,
    githubApi: input.githubApi.replace(/\/+$/, ""),
    env: {
      PATCH: input.patchPath,
      RUN_ID: input.runId,
      BRANCH: input.branch,
      REPO: input.repo,
      BASE: input.base,
      PROJECT_ID: input.projectId,
      TICKET_KEY: input.ticketKey,
      TICKET_TITLE: input.ticketTitle,
      MODEL: input.model,
      REPORT: JSON.stringify(input.report),
      CONTROL_PLANE_URL: input.controlPlaneOrigin,
    },
  };
  const wrapped = input.confinement.wrap(input.profilePath, process.execPath, [
    "--input-type=module",
    "-e",
    HARNESS,
    "--",
    input.platformDir,
  ]);
  const scrub = (text: string) => text.split(input.pushToken).join("***");
  return new Promise((resolve) => {
    const child = execFile(
      wrapped.command,
      wrapped.args,
      {
        cwd: input.publishDir,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: input.publishDir },
        maxBuffer: 4 * 1024 * 1024,
        timeout: input.timeoutMs ?? 5 * 60_000,
      },
      (err, stdout, stderr) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          parsed = null;
        }
        const answer = checkAnswer(parsed);
        if (answer) {
          resolve(answer);
          return;
        }
        const why = err ? `the publish child failed: ${scrub(stderr.trim()).slice(-300)}` : "";
        resolve({
          result: { kind: "error", reason: why || "the publish child answered no JSON" },
          log: [],
        });
      },
    );
    child.stdin?.end(JSON.stringify(request));
  });
}

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : [];

/** The child's answer, shape-checked: a bad platform commit can't hand the runner anything else. */
function checkAnswer(value: unknown): PublishOutcome | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const log = strings(v.log, 50).map((l) => l.slice(0, 500));
  if (v.kind === "published" && typeof v.branch === "string") {
    const pr = typeof v.pullRequest === "string" ? v.pullRequest.slice(0, 500) : null;
    return {
      result: {
        kind: "published",
        branch: v.branch.slice(0, 200),
        pullRequest: pr,
        tooling: strings(v.tooling, 50).map((f) => f.slice(0, 300)),
      },
      log,
    };
  }
  if (v.kind === "refused") {
    return { result: { kind: "refused", reasons: strings(v.reasons, 20) }, log };
  }
  if (v.kind === "error" && typeof v.reason === "string") {
    return { result: { kind: "error", reason: v.reason.slice(0, 500) }, log };
  }
  return null;
}
