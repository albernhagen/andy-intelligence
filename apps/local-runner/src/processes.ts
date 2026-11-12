import { execFile, spawn } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Agents never outlive the runner. Each agent runs in its own process group, and three things
 * stop it when the runner goes away:
 *
 * 1. `killAllAgents()` from the runner's `exit` handler, a second Ctrl-C and an uncaught error;
 * 2. a watchdog per agent (`sh`, its own process group) that kills the agent's group once the
 *    runner's pid is gone, which covers SIGKILL and crashes;
 * 3. `agent.pid` in the task's work directory (group id, start time and owning runner), so the
 *    next `start` kills a leftover the watchdog missed, once its runner is gone.
 *
 * `start` is single-instance per home (`acquireRunnerLock`), so a second runner never cleans up
 * a live runner's agents.
 */

const live = new Set<number>();

export function track(pgid: number): void {
  live.add(pgid);
}

export function untrack(pgid: number): void {
  live.delete(pgid);
}

/** SIGKILLs every live agent's process group. Synchronous, so it works in an `exit` handler. */
export function killAllAgents(): number {
  let killed = 0;
  for (const pgid of live) {
    try {
      process.kill(-pgid, "SIGKILL");
      killed += 1;
    } catch {
      // Already gone.
    }
  }
  live.clear();
  return killed;
}

/** Every 2 s: while the runner and the agent both live, wait; runner gone → kill the agent's group. */
const WATCHDOG = `
while kill -0 "$1" 2>/dev/null && kill -0 -"$2" 2>/dev/null; do sleep 2; done
kill -0 "$1" 2>/dev/null || kill -KILL -"$2" 2>/dev/null
exit 0
`;

export function startWatchdog(pgid: number, runnerPid: number = process.pid): void {
  const child = spawn("/bin/sh", ["-c", WATCHDOG, "watchdog", String(runnerPid), String(pgid)], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => undefined);
  child.unref();
}

/** The process's start time as `ps` prints it, or null when it doesn't exist. */
export async function startTime(pid: number): Promise<string | null> {
  try {
    const { stdout } = await run("ps", ["-o", "lstart=", "-p", String(pid)]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** A process by pid and start time: the same pid with another start time is another process. */
interface ProcessId {
  pid: number;
  started: string;
}

async function isAlive(p: Partial<ProcessId> | undefined): Promise<boolean> {
  return (
    p !== undefined &&
    Number.isInteger(p.pid) &&
    (p.pid ?? 0) > 1 &&
    typeof p.started === "string" &&
    (await startTime(p.pid!)) === p.started
  );
}

let self: ProcessId | null = null;
/** This runner's own pid and start time. */
export async function selfId(): Promise<ProcessId> {
  self ??= { pid: process.pid, started: (await startTime(process.pid)) ?? "unknown" };
  return self;
}

interface PidFile {
  pgid: number;
  started: string;
  /** The runner that started the agent: its leftover is cleaned only once that runner is gone. */
  runner: ProcessId;
}

export async function writePidFile(path: string, pgid: number): Promise<void> {
  const started = await startTime(pgid);
  if (!started) return;
  const record: PidFile = { pgid, started, runner: await selfId() };
  writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
}

/**
 * Kills agents a dead runner left running: each `work/*\/agent.pid` whose runner is gone and
 * whose agent still has the recorded start time (so a reused pid is never killed). An agent of
 * a live runner is never touched. Returns the run ids it stopped.
 */
export async function cleanLeftoverAgents(home: string): Promise<string[]> {
  const dir = join(home, "work");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const stopped: string[] = [];
  for (const name of names) {
    const path = join(dir, name, "agent.pid");
    let record: PidFile;
    try {
      record = JSON.parse(readFileSync(path, "utf8")) as PidFile;
    } catch {
      continue;
    }
    if (await isAlive(record.runner)) continue;
    if (await isAlive({ pid: record.pgid, started: record.started })) {
      try {
        process.kill(-record.pgid, "SIGKILL");
        stopped.push(name);
      } catch {
        // Gone in between.
      }
    }
    rmSync(path, { force: true });
  }
  return stopped;
}

/**
 * One runner per home: `runner.lock` holds the live runner's pid and start time, created
 * exclusively. A lock whose runner is gone is stale and taken over. Returns a release function,
 * or the pid of the runner that holds it.
 */
export async function acquireRunnerLock(
  home: string,
): Promise<{ release: () => void } | { heldBy: number }> {
  const path = join(home, "runner.lock");
  const me = await selfId();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, JSON.stringify(me), { flag: "wx", mode: 0o600 });
      return {
        release: () => {
          try {
            const held = JSON.parse(readFileSync(path, "utf8")) as ProcessId;
            if (held.pid === me.pid && held.started === me.started) rmSync(path, { force: true });
          } catch {
            // Already gone.
          }
        },
      };
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") throw err;
    }
    let held: Partial<ProcessId> | undefined;
    try {
      held = JSON.parse(readFileSync(path, "utf8")) as ProcessId;
    } catch {
      held = undefined;
    }
    if (held && (await isAlive(held))) return { heldBy: held.pid! };
    rmSync(path, { force: true });
  }
  throw new Error("couldn't take the runner lock");
}
