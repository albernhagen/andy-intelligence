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
 * 3. `agent.pid` in the task's work directory (group id and start time), so the next `start`
 *    kills a leftover the watchdog missed (e.g. the watchdog was killed too).
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

interface PidFile {
  pgid: number;
  started: string;
}

export async function writePidFile(path: string, pgid: number): Promise<void> {
  const started = await startTime(pgid);
  if (started)
    writeFileSync(path, JSON.stringify({ pgid, started } satisfies PidFile), { mode: 0o600 });
}

/**
 * Kills agents a previous runner left running: each `work/*\/agent.pid` whose process still has
 * the recorded start time (so a reused pid is never killed). Returns the run ids it stopped.
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
    if (
      Number.isInteger(record.pgid) &&
      record.pgid > 1 &&
      (await startTime(record.pgid)) === record.started
    ) {
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
