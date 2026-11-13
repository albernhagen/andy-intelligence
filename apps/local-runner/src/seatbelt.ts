import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The runner's own OS sandbox (macOS Seatbelt, `sandbox-exec`) around everything that reads
 * untrusted content or runs platform code (ADR-0098). The executor profile arrives through
 * `--settings`, not as managed settings, and its read denies are Linux paths, so the runner
 * confines the whole `claude` process itself: no file contents under any home (`/Users`) or the
 * runner's directory, except the task's checkout and what Claude Code needs to start; no writes
 * there either. Every rule here is the runner's, so a bad platform commit can't widen it.
 */

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** Claude Code's own files under the runner user's home: config, installs, state, caches. */
function claudeHomePaths(home: string) {
  return {
    readWrite: [
      join(home, ".claude"),
      join(home, ".cache", "claude"),
      join(home, ".local", "state", "claude"),
    ],
    readWriteFiles: [join(home, ".claude.json")],
    read: [
      join(home, ".local", "share", "claude"),
      join(home, ".local", "bin"),
      join(home, "Library", "Caches", "claude-cli-nodejs"),
    ],
  };
}

export interface ProfileInput {
  /** The runner's directory (`~/.local-runner`). */
  runnerHome: string;
  /** Readable (not writable): the task's checkout, the settings file, the platform checkout. */
  read: string[];
  /** Readable and writable (scratch output the runner reads back). */
  readWrite?: string[];
  /** Claude Code itself: its install, config and caches (the agent's profile, not the platform child's). */
  claude?: { command: string };
  /** The platform child: no network and no Keychain (Security server) either. */
  offline?: boolean;
  /** No Keychain (Security server), network on: the install and publish children. */
  noKeychain?: boolean;
  /**
   * A shared directory (`/tmp/agent`) this process may use only through its own subdirectory:
   * the rest of it is denied (no reads, no writes), so two tasks can't see each other's scratch.
   */
  scratch?: { root: string; own: string };
}

/** Real path, so Seatbelt matches it (`/var` is `/private/var`). Missing paths stay as given. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function quoted(path: string): string {
  if (/["\\\n]/.test(path)) throw new Error(`path not allowed in a sandbox profile: ${path}`);
  return `"${path}"`;
}

/** The directory of the real binary behind `command` (resolved through PATH and symlinks). */
export function binaryDir(command: string): string | null {
  const candidates = command.includes("/")
    ? [command]
    : (process.env.PATH ?? "").split(":").map((d) => join(d, command));
  const found = candidates.find((c) => existsSync(c));
  return found ? dirname(real(found)) : null;
}

/** The Seatbelt profile text. Later rules win, so allows come after the denies. */
export function seatbeltProfile(input: ProfileInput): string {
  const home = real(homedir());
  const lines = [
    "(version 1)",
    "(allow default)",
    `(deny file-read-data file-write* (subpath "/Users") (subpath ${quoted(real(input.runnerHome))}) (subpath ${quoted(home)}))`,
  ];
  if (input.scratch) {
    lines.push(`(deny file-read-data file-write* (subpath ${quoted(real(input.scratch.root))}))`);
  }
  const allowRead = [...input.read];
  // Node runs the runner, the platform scripts and (often) Claude Code: its install is readable.
  allowRead.push(dirname(dirname(real(process.execPath))));
  const allowReadWrite = [
    ...(input.readWrite ?? []),
    ...(input.scratch ? [input.scratch.own] : []),
  ];
  const allowReadWriteFiles: string[] = [];
  if (input.claude) {
    const dir = binaryDir(input.claude.command);
    if (dir) allowRead.push(dir);
    const paths = claudeHomePaths(home);
    allowRead.push(...paths.read);
    allowReadWrite.push(...paths.readWrite);
    allowReadWriteFiles.push(...paths.readWriteFiles);
  }
  for (const p of allowRead) lines.push(`(allow file-read-data (subpath ${quoted(real(p))}))`);
  for (const p of allowReadWrite)
    lines.push(`(allow file-read-data file-write* (subpath ${quoted(real(p))}))`);
  for (const p of allowReadWriteFiles) {
    // The file and its atomic-write siblings (`.claude.json.tmp…`, `.claude.json.backup`).
    lines.push(
      `(allow file-read-data file-write* (prefix ${quoted(real(dirname(p)) + "/" + p.split("/").at(-1))}))`,
    );
  }
  if (input.offline) lines.push("(deny network*)");
  if (input.offline || input.noKeychain) {
    lines.push(
      '(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd"))',
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Wraps a command so it runs under `profilePath`. */
export interface Confinement {
  wrap(profilePath: string, command: string, args: string[]): { command: string; args: string[] };
  /**
   * The live check before the agent (fail closed): under the profile, a file in the runner's
   * directory can't be read, the checkout can be listed and written only when `writable` (a
   * build), and (when the runner user's home is under /Users) the home's Keychain folder can't
   * be listed. Null when it holds.
   */
  check(input: {
    profilePath: string;
    checkout: string;
    runDir: string;
    writable?: boolean;
  }): Promise<string | null>;
}

export const seatbelt: Confinement = {
  wrap: (profilePath, command, args) => ({
    command: SANDBOX_EXEC,
    args: ["-f", profilePath, command, ...args],
  }),
  async check({ profilePath, checkout, runDir, writable = false }) {
    if (process.platform !== "darwin" || !existsSync(SANDBOX_EXEC)) {
      return "macOS sandbox-exec is not available";
    }
    const canary = join(runDir, `canary-${randomBytes(6).toString("hex")}`);
    const nonce = randomBytes(12).toString("hex");
    await writeFile(canary, nonce, { mode: 0o600 });
    const probe = join(checkout, `.sandbox-probe-${randomBytes(6).toString("hex")}`);
    const confined = async (cmd: string, args: string[]) => {
      try {
        const { stdout } = await run(SANDBOX_EXEC, ["-f", profilePath, cmd, ...args], {
          cwd: checkout,
          timeout: 10_000,
        });
        return { ok: true, stdout };
      } catch (err) {
        return { ok: false, stdout: String((err as { stdout?: unknown }).stdout ?? "") };
      }
    };
    try {
      const read = await confined("/bin/cat", [canary]);
      if (read.ok || read.stdout.includes(nonce)) return "a file outside the checkout was readable";
      if (!(await confined("/bin/ls", [checkout])).ok) return "the checkout wasn't readable";
      const wrote = (await confined("/usr/bin/touch", [probe])).ok && existsSync(probe);
      if (wrote !== writable)
        return writable ? "the checkout wasn't writable" : "the checkout was writable";
      const keychains = join(real(homedir()), "Library", "Keychains");
      if (real(homedir()).startsWith("/Users/") && (await confined("/bin/ls", [keychains])).ok)
        return "the home's Keychain folder was listable";
      return null;
    } finally {
      await rm(canary, { force: true });
      await rm(probe, { force: true });
    }
  },
};

/** No sandbox: tests on Linux CI only (`sandbox-exec` is macOS-only). Never used by `main`. */
export const noConfinement: Confinement = {
  wrap: (_profilePath, command, args) => ({ command, args }),
  check: async () => null,
};
