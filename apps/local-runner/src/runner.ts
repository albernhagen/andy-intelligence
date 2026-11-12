import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { RUNNER_LIMITS } from "@andy/contracts";
import { sleep, type ControlPlane } from "./api";
import { LOCAL_LIMITS } from "./config";
import type { Logger } from "./log";
import { runTask, type TaskDeps } from "./task";

/**
 * Holds `caffeinate -i` while an agent task is active (idle sleep only; closing the lid still
 * sleeps, ADR-0089 "Laptop sleeps"). `-w` ties it to the runner, so it never outlives it.
 */
export interface KeepAwake {
  set(active: boolean): void;
}

export function caffeinate(log: Logger, command = "caffeinate"): KeepAwake {
  let child: ChildProcess | null = null;
  return {
    set(active) {
      if (active && child === null) {
        child = spawn(command, ["-i", "-w", String(process.pid)], { stdio: "ignore" });
        child.on("error", (err) => log("WARNING", "caffeinate failed", { error: err.message }));
        child.on("exit", () => (child = null));
      } else if (!active && child !== null) {
        child.kill();
        child = null;
      }
    },
  };
}

export interface LoopOptions {
  api: ControlPlane;
  secret: string;
  runsAtOnce: number;
  log: Logger;
  task: Omit<TaskDeps, "api" | "log" | "heartbeatMs">;
  keepAwake: KeepAwake;
  signal: AbortSignal;
  now?: () => Date;
  /** Milliseconds per contract second; tests shrink it. */
  msPerSecond?: number;
  idleMs?: number;
}

export type LoopEnd = "idle" | "stopped" | "unauthorized";

/**
 * Polls `POST /runner/claim` every `pollSeconds` while a slot is free (none while full), runs each
 * claimed task, and exits after `idleHours` without one (ADR-0089 §Polling, §Caps).
 */
export async function runLoop(options: LoopOptions): Promise<LoopEnd> {
  const now = options.now ?? (() => new Date());
  const ms = options.msPerSecond ?? 1000;
  const idleMs = options.idleMs ?? LOCAL_LIMITS.idleHours * 3600 * 1000;
  let pollSeconds: number = RUNNER_LIMITS.pollSeconds;
  let lastWork = now().getTime();
  const active = new Set<Promise<unknown>>();
  let wake = new AbortController();
  let end: LoopEnd = "stopped";

  options.log("INFO", "local runner polling", { runsAtOnce: options.runsAtOnce });
  while (!options.signal.aborted) {
    if (active.size === 0 && now().getTime() - lastWork >= idleMs) {
      options.log("INFO", "no agent task for the idle limit; exiting", {
        idleHours: idleMs / 3600_000,
      });
      end = "idle";
      break;
    }
    let waitSeconds = pollSeconds;
    if (active.size < options.runsAtOnce) {
      const claim = await options.api.claim(options.secret);
      if (claim.kind === "ok") {
        pollSeconds = claim.response.pollSeconds;
        const heartbeatMs = claim.response.heartbeatSeconds * ms;
        waitSeconds = pollSeconds;
        const run = claim.response.run;
        if (run) {
          lastWork = now().getTime();
          options.keepAwake.set(true);
          const task: Promise<unknown> = runTask(
            run,
            {
              ...options.task,
              api: options.api,
              log: options.log,
              heartbeatMs,
            },
            options.signal,
          )
            .catch((err: unknown) =>
              options.log("ERROR", "agent task crashed", { runId: run.runId, error: String(err) }),
            )
            .finally(() => {
              active.delete(task);
              lastWork = now().getTime();
              options.keepAwake.set(active.size > 0);
              wake.abort();
            });
          active.add(task);
        }
      } else if (claim.kind === "wait") {
        waitSeconds = claim.seconds;
      } else if (claim.kind === "unauthorized") {
        options.log(
          "ERROR",
          "the control plane refused the runner secret (revoked or expired); mint a new one at /settings/runners and run local-runner login",
        );
        end = "unauthorized";
        break;
      } else {
        options.log("WARNING", "claim failed; polling again", { reason: claim.reason });
      }
    }
    // While full, wait for a task to end (no polls); otherwise for the poll interval.
    const until = AbortSignal.any([options.signal, wake.signal]);
    await sleep(active.size >= options.runsAtOnce ? 24 * 3600 * 1000 : waitSeconds * ms, until);
    if (wake.signal.aborted) wake = new AbortController();
  }
  await Promise.allSettled([...active]);
  options.keepAwake.set(false);
  return end;
}

/** Keeps the newest kept work directories (failed or lost tasks), removes the rest. */
export function pruneWork(home: string, keep: number = LOCAL_LIMITS.keptWorkDirs): string[] {
  const dir = join(home, "work");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const dated = names
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  const removed = dated.slice(keep).map((d) => d.name);
  for (const name of removed) rmSync(join(dir, name), { recursive: true, force: true });
  return removed;
}
