import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkRepo } from "./config";

const run = promisify(execFile);

/**
 * git with no system or global config, no hooks, no fsmonitor and no prompts: a repository's
 * content can't make the runner's own git run code (as in the Actions executor's git steps).
 */
export async function git(
  args: string[],
  cwd?: string,
  extraEnv: Record<string, string> = {},
): Promise<string> {
  const { stdout } = await run(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
    {
      cwd,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "/",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        ...extraEnv,
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return stdout.trim();
}

/** Serializes fetches per cache, so two tasks don't race on one repository's FETCH_HEAD. */
const locks = new Map<string, Promise<unknown>>();
async function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = locks.get(key) ?? Promise.resolve();
  const next = before.catch(() => undefined).then(fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

/**
 * A bare clone per repository under `<home>/repos`, fetched before each task; worktrees are
 * added from it. Public repositories only in slice 5 (no credential on the runner's git).
 */
export class RepoCache {
  constructor(
    private readonly home: string,
    private readonly gitBase: string,
  ) {}

  /** The bare clone of `repo` (worktrees' git directories live under it). */
  path(repo: string): string {
    return this.dir(repo);
  }

  /** The default branch's name (the bare clone's HEAD), e.g. "main". */
  async defaultBranch(repo: string): Promise<string> {
    const name = await git(["symbolic-ref", "--short", "HEAD"], this.dir(repo));
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(name)) throw new Error("unexpected default branch name");
    return name;
  }

  private dir(repo: string): string {
    return join(this.home, "repos", `${checkRepo(repo).replace("/", "__")}.git`);
  }

  /** Fetches the default branch (or `ref`) and returns its commit SHA. */
  async fetch(repo: string, ref = "HEAD"): Promise<string> {
    const dir = this.dir(repo);
    return locked(dir, async () => {
      if (!existsSync(dir)) {
        await mkdir(join(this.home, "repos"), { recursive: true, mode: 0o700 });
        await git(["clone", "--bare", "--quiet", `${this.gitBase}/${repo}.git`, dir]);
      }
      await git(["fetch", "--quiet", "--no-tags", "origin", ref], dir);
      return git(["rev-parse", "--verify", "FETCH_HEAD^{commit}"], dir);
    });
  }

  /** A detached worktree of `sha` at `path`. */
  async addWorktree(repo: string, sha: string, path: string): Promise<void> {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("not a commit SHA");
    const dir = this.dir(repo);
    await locked(dir, () => git(["worktree", "add", "--quiet", "--detach", path, sha], dir));
  }

  /** Removes the worktree and its bookkeeping in the cache. */
  async removeWorktree(repo: string, path: string): Promise<void> {
    const dir = this.dir(repo);
    await locked(dir, async () => {
      await git(["worktree", "remove", "--force", path], dir).catch(() => undefined);
      await git(["worktree", "prune"], dir).catch(() => undefined);
    });
  }
}

/** The worktree's uncommitted changes, one path per line ("" when clean). */
export function status(path: string): Promise<string> {
  return git(["status", "--porcelain", "--untracked-files=all"], path);
}

/** A worktree's own git directory, read before the agent runs (the agent can rewrite `.git`). */
export function gitDirOf(path: string): Promise<string> {
  return git(["rev-parse", "--absolute-git-dir"], path);
}
