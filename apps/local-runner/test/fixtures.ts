import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaimedRun, RunContextResponse, RunStep } from "@andy/contracts";
import type { Logger } from "../src/log";

const here = dirname(fileURLToPath(import.meta.url));
export const WORKSPACE = resolve(here, "..", "..", "..");

/** The platform files a task loads, copied from this workspace (read only). */
const PLATFORM_FILES = [
  "scripts/executor-profile.mjs",
  "scripts/executor-procedure.mjs",
  "scripts/executor-report.mjs",
  "scripts/executor-sandbox.mjs",
  "platform/executor/profile.json",
  "platform/procedures/refine.md",
  "platform/procedures/refine.schema.json",
  "platform/procedures/plan.md",
  "platform/procedures/plan.schema.json",
];

export const PLATFORM_REPO = "albernhagen/andy-intelligence";
export const PROJECT_REPO = "andy/project";

function gitIn(cwd: string, args: string[]) {
  execFileSync("git", args, {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    stdio: "ignore",
  });
}

/** A bare repository at `<remotes>/<repo>.git` with one commit of `files`. */
export function makeRemote(remotes: string, repo: string, files: Record<string, string>) {
  const src = mkdtempSync(join(tmpdir(), "lr-src-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(src, path)), { recursive: true });
    writeFileSync(join(src, path), content);
  }
  gitIn(src, ["init", "--quiet", "--initial-branch=main"]);
  gitIn(src, ["add", "-A"]);
  gitIn(src, ["commit", "--quiet", "-m", "init"]);
  mkdirSync(dirname(join(remotes, repo)), { recursive: true });
  gitIn(src, ["clone", "--bare", "--quiet", src, join(remotes, `${repo}.git`)]);
}

export interface StubConfig {
  agent?: "succeed" | "fail" | "hang";
  agentDelayMs?: number;
  sandbox?: "works" | "leaks";
  ignoreSettingSources?: boolean;
  output?: unknown;
}

export interface Env {
  root: string;
  home: string;
  gitBase: string;
  claude: string;
  /** A hook in the project's settings would touch this. */
  hookMarker: string;
  setStub(config: StubConfig): void;
  calls(): { args: string[]; cwd: string; envNames: string[]; stdin: string }[];
}

export function makeEnv(stub: StubConfig = {}): Env {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "local-runner-")));
  const remotes = join(root, "remotes");
  const hookMarker = join(root, "project-hook-ran");
  makeRemote(
    remotes,
    PLATFORM_REPO,
    Object.fromEntries(PLATFORM_FILES.map((f) => [f, readFileSync(join(WORKSPACE, f), "utf8")])),
  );
  const hooks = {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: `touch '${hookMarker}'` }] }],
      PreToolUse: [
        { matcher: "*", hooks: [{ type: "command", command: `touch '${hookMarker}'` }] },
      ],
    },
    permissions: { allow: ["Bash"] },
  };
  makeRemote(remotes, PROJECT_REPO, {
    "README.md": "# Project\n",
    ".claude/settings.json": JSON.stringify(hooks),
    ".claude/settings.local.json": JSON.stringify(hooks),
    ".github/CODEOWNERS": "/docs/ @andy\n",
  });
  const stubDir = join(root, "stub");
  mkdirSync(stubDir);
  const claude = join(stubDir, "claude");
  copyFileSync(join(here, "stub-claude.mjs"), claude);
  chmodSync(claude, 0o755);
  const setStub = (config: StubConfig) =>
    writeFileSync(
      join(stubDir, "config.json"),
      JSON.stringify({ agent: "succeed", sandbox: "works", ...config }),
    );
  setStub(stub);
  return {
    root,
    home: join(root, "home"),
    gitBase: `file://${remotes}`,
    claude,
    hookMarker,
    setStub,
    calls: () => {
      try {
        return readFileSync(join(stubDir, "calls.jsonl"), "utf8")
          .trim()
          .split("\n")
          .filter((l) => l !== "")
          .map((l) => JSON.parse(l) as ReturnType<Env["calls"]>[number]);
      } catch {
        return [];
      }
    },
  };
}

let counter = 0;
export function task(step: RunStep = "refine"): { claim: ClaimedRun; context: RunContextResponse } {
  counter += 1;
  const runId = `run-${counter}-${Date.now()}`;
  return {
    claim: {
      runId,
      token: `airt_${"t".repeat(30)}${counter}`,
      step,
      ticketKey: "AI-7",
      repo: PROJECT_REPO,
      deadline: new Date(Date.now() + 3600_000).toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
    context: {
      runId,
      step,
      model: "claude-opus-5-5",
      maxTurns: 30,
      prompt: "Ticket AI-7: Show the board. (untrusted ticket text)",
      ticket: { projectId: "ai", key: "AI-7", title: "Show the board" },
      branch: null,
      sync: null,
    },
  };
}

/** Collects log lines; never prints. */
export function memoryLogger(): Logger & {
  lines: { severity: string; message: string; fields: Record<string, unknown> }[];
} {
  const lines: { severity: string; message: string; fields: Record<string, unknown> }[] = [];
  const log = ((severity, message, fields = {}) => {
    lines.push({ severity, message, fields });
  }) as Logger & { lines: typeof lines };
  log.lines = lines;
  return log;
}
