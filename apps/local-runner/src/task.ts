import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClaimedRun, RunPhase, RunReportRequest } from "@andy/contracts";
import { READ_ONLY_ALLOWED, READ_ONLY_DENIED, agentArgs, agentEnv, spawnAgent } from "./agent";
import type { ControlPlane } from "./api";
import { LOCAL_LIMITS, LOCAL_STEPS } from "./config";
import type { RepoCache } from "./git";
import { errorText, type Logger } from "./log";
import { loadPlatform as defaultLoadPlatform, type Platform } from "./platform";
import { checkSandbox as defaultCheckSandbox, type SandboxCheckInput } from "./sandbox-check";

/**
 * One claimed agent task, start to end (ADR-0089 slice 5): heartbeats from the claim on, the
 * platform checkout at the commit fetched for this task, the project checkout in its own
 * worktree, the step's profile, the live sandbox check, the agent, the report.
 *
 * - Heartbeat `cancel: true`: stop the agent, report `cancelled`, remove the work directory.
 * - Heartbeat 409 (or a dead token): the task ended on the control plane (lease lost, deadline,
 *   revoke); stop the agent, report nothing, keep the work directory for inspection.
 * - Build and sync are refused with a failed report (slice 6: local build and publish).
 */

export type TaskOutcome =
  /** Reported; the control plane answered recorded or duplicate. */
  | "reported"
  | "cancelled"
  /** The control plane ended it (heartbeat 409): nothing reported, work kept. */
  | "ended"
  /** The report couldn't be delivered. */
  | "unreported"
  /** A step this runner doesn't run yet. */
  | "refused";

export interface TaskDeps {
  api: ControlPlane;
  repos: RepoCache;
  home: string;
  claudeCommand: string;
  platformRepo: string;
  /** How often to heartbeat (the claim's heartbeatSeconds, in ms). */
  heartbeatMs: number;
  log: Logger;
  now?: () => Date;
  loadPlatform?: (root: string) => Promise<Platform>;
  checkSandbox?: (input: SandboxCheckInput) => Promise<string | null>;
}

class Stopped extends Error {}

const emptyReport = (status: RunReportRequest["status"], summary: string): RunReportRequest => ({
  status,
  summary,
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
});

export async function runTask(
  claimed: ClaimedRun,
  deps: TaskDeps,
  shutdown: AbortSignal,
): Promise<TaskOutcome> {
  const now = deps.now ?? (() => new Date());
  const ids = { runId: claimed.runId, ticketKey: claimed.ticketKey, step: claimed.step };
  const runDir = join(deps.home, "work", claimed.runId);
  const projectDir = join(runDir, "project");
  const platformDir = join(runDir, "platform");
  const worktrees: { repo: string; path: string }[] = [];
  const stop = new AbortController();
  let why: "cancel" | "ended" | "shutdown" | null = null;
  let phase: RunPhase = "starting";

  const onShutdown = () => {
    why ??= "shutdown";
    stop.abort();
  };
  shutdown.addEventListener("abort", onShutdown, { once: true });
  if (shutdown.aborted) onShutdown();

  let beating = false;
  const beat = async () => {
    if (beating || why !== null) return;
    beating = true;
    try {
      const result = await deps.api.heartbeat(claimed.runId, claimed.token, phase);
      if (result.kind === "ok" && result.cancel) {
        deps.log("INFO", "agent task cancelled on the control plane; stopping the agent", ids);
        why ??= "cancel";
        stop.abort();
      } else if (result.kind === "ended") {
        deps.log("WARNING", "the control plane ended the agent task; stopping it", {
          ...ids,
          status: result.status,
        });
        why ??= "ended";
        stop.abort();
      } else if (result.kind === "error") {
        deps.log("WARNING", "heartbeat failed; retrying at the next interval", {
          ...ids,
          reason: result.reason,
        });
      }
    } finally {
      beating = false;
    }
  };
  const heartbeats = setInterval(() => void beat(), deps.heartbeatMs);
  const checkpoint = () => {
    if (stop.signal.aborted) throw new Stopped();
  };

  const removeWork = async () => {
    for (const w of worktrees) await deps.repos.removeWorktree(w.repo, w.path);
    await rm(runDir, { recursive: true, force: true });
  };

  const report = async (body: RunReportRequest): Promise<TaskOutcome> => {
    phase = "reporting";
    const result = await deps.api.report(claimed.runId, claimed.token, body);
    if (result.kind === "ok") {
      deps.log("INFO", "agent task reported", {
        ...ids,
        status: body.status,
        result: result.result,
      });
      return "reported";
    }
    deps.log("ERROR", "agent task report not delivered; the lease will lapse", {
      ...ids,
      reason: result.reason,
      ...(result.kind === "rejected" ? { status: result.status } : {}),
      workDir: runDir,
    });
    return "unreported";
  };

  deps.log("INFO", "agent task claimed", {
    ...ids,
    repo: claimed.repo,
    deadline: claimed.deadline,
  });
  try {
    await mkdir(runDir, { recursive: true, mode: 0o700 });

    if (!(LOCAL_STEPS as readonly string[]).includes(claimed.step)) {
      deps.log("WARNING", "step not supported on the local runner yet; refusing", ids);
      await report(
        emptyReport(
          "failed",
          `The local runner can't run ${claimed.step} agent tasks yet (local build and publish is ADR-0089 slice 6), so nothing ran. Set this ticket's executor to actions to run it on GitHub Actions.`,
        ),
      );
      await removeWork();
      return "refused";
    }

    const context = await deps.api.context(claimed.runId, claimed.token);
    if (context.step !== claimed.step) throw new Error("context step differs from the claim");
    checkpoint();

    const platformSha = await deps.repos.fetch(deps.platformRepo);
    await deps.repos.addWorktree(deps.platformRepo, platformSha, platformDir);
    worktrees.push({ repo: deps.platformRepo, path: platformDir });
    const platform = await (deps.loadPlatform ?? defaultLoadPlatform)(platformDir);
    const projectSha = await deps.repos.fetch(claimed.repo);
    await deps.repos.addWorktree(claimed.repo, projectSha, projectDir);
    worktrees.push({ repo: claimed.repo, path: projectDir });
    deps.log("INFO", "checkouts ready", { ...ids, platformSha, projectSha, workDir: runDir });
    checkpoint();

    const settingsPath = join(runDir, "settings.json");
    await writeFile(
      settingsPath,
      `${JSON.stringify(platform.settings(context.step, projectDir), null, 2)}\n`,
      { mode: 0o600 },
    );
    const { prompt, schema } = platform.prompt(context.step, context.prompt);

    const sandboxProblem = await (deps.checkSandbox ?? defaultCheckSandbox)({
      platform,
      claudeCommand: deps.claudeCommand,
      worktree: projectDir,
      runDir,
      signal: stop.signal,
    });
    checkpoint();
    if (sandboxProblem) {
      deps.log("ERROR", "sandbox check failed; the agent did not run", {
        ...ids,
        problem: sandboxProblem,
        workDir: runDir,
      });
      await report(
        emptyReport(
          "failed",
          `The sandbox check failed, so the agent did not run: ${sandboxProblem}. See the local runner's log.`,
        ),
      );
      return "reported";
    }

    phase = "agent";
    const untilDeadline = Date.parse(claimed.deadline) - now().getTime() - 60_000;
    const timeoutMs = Math.max(
      1000,
      Math.min(LOCAL_LIMITS.readOnlyAgentMinutes * 60_000, untilDeadline),
    );
    deps.log("INFO", "agent started", { ...ids, model: context.model, maxTurns: context.maxTurns });
    const agent = await spawnAgent({
      command: deps.claudeCommand,
      args: agentArgs({
        model: context.model,
        maxTurns: context.maxTurns,
        settingsPath,
        schema,
        allowedTools: READ_ONLY_ALLOWED,
        disallowedTools: READ_ONLY_DENIED,
      }),
      cwd: projectDir,
      env: agentEnv(),
      prompt,
      outputPath: join(runDir, "agent.jsonl"),
      timeoutMs,
      signal: stop.signal,
    });
    deps.log("INFO", "agent exited", {
      ...ids,
      exitCode: agent.exitCode,
      timedOut: agent.timedOut,
      stopped: agent.stopped,
      truncated: agent.truncated,
      ...(agent.exitCode === 0 ? {} : { stderrTail: agent.stderrTail.slice(-500) }),
    });
    checkpoint();

    const ok = agent.exitCode === 0 && !agent.timedOut && !agent.truncated;
    const reason = agent.timedOut
      ? "The agent ran over its time limit and the local runner stopped it"
      : agent.truncated
        ? "The agent's output went over the local runner's cap and it was stopped"
        : agent.exitCode === 0
          ? ""
          : `The agent exited with code ${agent.exitCode ?? "none"}`;
    const body = platform.report({
      outcome: ok ? "success" : "failure",
      messages: agent.messages,
      reason,
    });
    const outcome = await report(body);
    if (outcome === "reported" && body.status === "succeeded") await removeWork();
    else deps.log("INFO", "work directory kept for inspection", { ...ids, workDir: runDir });
    return outcome;
  } catch (err) {
    if (err instanceof Stopped || why !== null) return settleStopped();
    deps.log("ERROR", "agent task failed in the local runner", {
      ...ids,
      error: errorText(err),
      workDir: runDir,
    });
    await report(
      emptyReport(
        "failed",
        `The local runner failed before the agent finished: ${errorText(err)}.`,
      ),
    );
    return "reported";
  } finally {
    clearInterval(heartbeats);
    shutdown.removeEventListener("abort", onShutdown);
  }

  async function settleStopped(): Promise<TaskOutcome> {
    if (why === "cancel") {
      await report(emptyReport("cancelled", "Cancelled: the local runner stopped the agent."));
      await removeWork();
      return "cancelled";
    }
    if (why === "ended") {
      deps.log("WARNING", "agent task ended on the control plane; nothing reported, work kept", {
        ...ids,
        workDir: runDir,
      });
      return "ended";
    }
    const outcome = await report(
      emptyReport("failed", "The local runner was stopped on its Mac before the agent finished."),
    );
    deps.log("INFO", "work directory kept for inspection", { ...ids, workDir: runDir });
    return outcome;
  }
}
