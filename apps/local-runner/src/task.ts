import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClaimedRun, RunPhase, RunReportRequest } from "@andy/contracts";
import { READ_ONLY_ALLOWED, READ_ONLY_DENIED, agentArgs, agentEnv, spawnAgent } from "./agent";
import type { ControlPlane } from "./api";
import { checkBash } from "./bash-check";
import { collectChange } from "./change";
import { LOCAL_LIMITS, LOCAL_STEPS } from "./config";
import { gitDirOf, type RepoCache } from "./git";
import { installDependencies } from "./install";
import { errorText, type Logger } from "./log";
import { loadPlatform } from "./platform";
import { publishChange } from "./publish";
import { seatbeltProfile, type Confinement } from "./seatbelt";

/**
 * One claimed agent task, start to end (ADR-0089 slice 5): heartbeats from the claim on, the
 * platform checkout at the commit fetched for this task, the project checkout in its own
 * worktree, the live sandbox check, the step's profile, the agent under Seatbelt, the report.
 *
 * - Heartbeat `cancel: true`: stop the agent, report `cancelled`, remove the work directory.
 * - Heartbeat 409 (or a dead token): the task ended on the control plane (lease lost, deadline,
 *   revoke); stop the agent, report nothing, keep the work directory for inspection.
 * - Build (slice 6): the checkout is writable, dependencies are installed first (scripts off),
 *   the profile decides the tools; afterwards the change is collected, the run's one push token
 *   is fetched and the platform's own publish script pushes `agent/<KEY>/<runId>` and opens the
 *   PR (`publish.ts`). The token lives only in this function's memory until the publish child
 *   has it on stdin; it is never logged, stored or reported.
 * - Sync is refused with a failed report: it stays on GitHub Actions (ADR-0094).
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
  /** The control plane's origin: the ticket link on a build's PR. */
  origin: string;
  /** Where a build pushes and opens its PR (tests: local fakes). */
  gitBase: string;
  githubApi: string;
  /** How often to heartbeat (the claim's heartbeatSeconds, in ms). */
  heartbeatMs: number;
  log: Logger;
  now?: () => Date;
  /** The macOS sandbox (Seatbelt); tests on Linux pass `noConfinement`. */
  confinement: Confinement;
}

class Stopped extends Error {}

/** The build profile's writable scratch directory (its sandbox `allowWrite`), as on Actions. */
const AGENT_TMP = "/tmp/agent";

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
  const publishDir = join(runDir, "publish");
  const build = claimed.step === "build";
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
          `The local runner doesn't run ${claimed.step} agent tasks (they stay on GitHub Actions), so nothing ran. Set this ticket's executor to actions to run it there.`,
        ),
      );
      await removeWork();
      return "refused";
    }

    const context = await deps.api.context(claimed.runId, claimed.token);
    if (context.step !== claimed.step) throw new Error("context step differs from the claim");
    const branch = `agent/${claimed.ticketKey}/${claimed.runId}`;
    if (build && (context.branch !== branch || context.ticket?.key !== claimed.ticketKey)) {
      throw new Error("the build's context doesn't name this run's branch and ticket");
    }
    checkpoint();

    const platformSha = await deps.repos.fetch(deps.platformRepo);
    await deps.repos.addWorktree(deps.platformRepo, platformSha, platformDir);
    worktrees.push({ repo: deps.platformRepo, path: platformDir });
    const projectSha = await deps.repos.fetch(claimed.repo);
    await deps.repos.addWorktree(claimed.repo, projectSha, projectDir);
    worktrees.push({ repo: claimed.repo, path: projectDir });
    deps.log("INFO", "checkouts ready", { ...ids, platformSha, projectSha, workDir: runDir });
    // Read before the agent: it can rewrite the checkout's `.git` file, never this directory.
    const gitDir = build ? await gitDirOf(projectDir) : null;
    const repoCache = deps.repos.path(claimed.repo);
    checkpoint();

    // Two Seatbelt profiles, both the runner's own (ADR-0098): the platform child reads only the
    // two checkouts and the agent's stream, offline and without the Keychain; the agent reads
    // only its checkout, its settings and Claude Code's own files.
    const streamPath = join(runDir, "agent.jsonl");
    const settingsPath = join(runDir, "settings.json");
    const platformProfile = join(runDir, "platform.sb");
    const agentProfile = join(runDir, "agent.sb");
    await writeFile(
      platformProfile,
      seatbeltProfile({
        runnerHome: deps.home,
        read: [platformDir, projectDir, streamPath],
        offline: true,
      }),
      { mode: 0o600 },
    );
    // A build writes its checkout; git there reads (never writes) the repository cache.
    await writeFile(
      agentProfile,
      seatbeltProfile(
        build
          ? {
              runnerHome: deps.home,
              read: [settingsPath, repoCache],
              readWrite: [projectDir],
              claude: { command: deps.claudeCommand },
            }
          : {
              runnerHome: deps.home,
              read: [projectDir, settingsPath],
              claude: { command: deps.claudeCommand },
            },
      ),
      { mode: 0o600 },
    );
    const confinementProblem = await deps.confinement.check({
      profilePath: agentProfile,
      checkout: projectDir,
      runDir,
      writable: build,
    });
    if (confinementProblem) {
      deps.log("ERROR", "sandbox check failed; the agent did not run", {
        ...ids,
        problem: confinementProblem,
        workDir: runDir,
      });
      await report(
        emptyReport(
          "failed",
          `The sandbox check failed, so the agent did not run: ${confinementProblem}. See the local runner's log.`,
        ),
      );
      return "reported";
    }

    const platform = loadPlatform({
      root: platformDir,
      confinement: deps.confinement,
      profilePath: platformProfile,
    });
    await writeFile(
      settingsPath,
      `${JSON.stringify(await platform.settings(context.step, projectDir), null, 2)}\n`,
      { mode: 0o600 },
    );
    const { prompt, schema } = await platform.prompt(context.step, context.prompt);
    checkpoint();

    if (build) {
      const installed = await installDependencies({
        checkout: projectDir,
        runDir,
        runnerHome: deps.home,
        confinement: deps.confinement,
        timeoutMs: LOCAL_LIMITS.installMinutes * 60_000,
        signal: stop.signal,
      });
      if (installed.kind === "failed") {
        deps.log("ERROR", "dependency install failed; the agent did not run", {
          ...ids,
          reason: installed.reason,
          workDir: runDir,
        });
        await report(
          emptyReport(
            "failed",
            `Installing dependencies failed, so the agent did not run: ${installed.reason}.`,
          ),
        );
        return "reported";
      }
      deps.log("INFO", "dependencies ready", { ...ids, install: installed.kind });
      await mkdir(AGENT_TMP, { recursive: true, mode: 0o700 });
      checkpoint();
      // Fail closed (ADR-0102): Bash runs in Claude Code's sandbox, or no build agent runs.
      const bashProblem = await checkBash({
        claudeCommand: deps.claudeCommand,
        confinement: deps.confinement,
        profilePath: agentProfile,
        settingsPath,
        checkout: projectDir,
        runDir,
        gitDir: gitDir!,
        signal: stop.signal,
        extraEnv: { TMPDIR: AGENT_TMP },
      });
      checkpoint();
      if (bashProblem) {
        deps.log("ERROR", "Bash sandbox check failed; the agent did not run", {
          ...ids,
          problem: bashProblem,
          workDir: runDir,
        });
        await report(
          emptyReport(
            "failed",
            `The Bash sandbox check failed, so the build agent did not run: ${bashProblem}. See the local runner's log; set this ticket's executor to actions to build it on GitHub Actions.`,
          ),
        );
        return "reported";
      }
      deps.log("INFO", "Bash sandbox check passed", ids);
    }

    phase = "agent";
    const untilDeadline = Date.parse(claimed.deadline) - now().getTime() - 60_000;
    const timeoutMs = Math.max(
      1000,
      Math.min(
        (build ? LOCAL_LIMITS.buildAgentMinutes : LOCAL_LIMITS.readOnlyAgentMinutes) * 60_000,
        untilDeadline,
      ),
    );
    deps.log("INFO", "agent started", { ...ids, model: context.model, maxTurns: context.maxTurns });
    const command = deps.confinement.wrap(
      agentProfile,
      deps.claudeCommand,
      agentArgs({
        model: context.model,
        maxTurns: context.maxTurns,
        settingsPath,
        schema,
        tools: build ? undefined : { allowed: READ_ONLY_ALLOWED, disallowed: READ_ONLY_DENIED },
      }),
    );
    const agent = await spawnAgent({
      ...command,
      cwd: projectDir,
      env: agentEnv(build ? { TMPDIR: AGENT_TMP } : {}),
      prompt,
      outputPath: streamPath,
      timeoutMs,
      signal: stop.signal,
      pidFile: join(runDir, "agent.pid"),
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
    let body = await platform.report({
      outcome: ok ? "success" : "failure",
      streamPath,
      reason,
    });
    if (build) {
      checkpoint();
      body = await publishBuild(body, {
        gitDir: gitDir!,
        repoCache,
        projectSha,
        branch,
        model: context.model,
        ticket: context.ticket!,
      });
    }
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

  /**
   * A build's change, published as on Actions (ADR-0063): nothing to publish leaves the report
   * as the agent made it; a change that can't be collected, a refused push token or refused
   * publish checks fail the run with the reason; a pushed branch and PR go with the report.
   */
  async function publishBuild(
    body: RunReportRequest,
    run: {
      gitDir: string;
      repoCache: string;
      projectSha: string;
      branch: string;
      model: string;
      ticket: { projectId: string; key: string; title: string };
    },
  ): Promise<RunReportRequest> {
    const failed = (why: string): RunReportRequest => ({
      ...body,
      status: "failed",
      summary: `${why}\n\n${body.summary ?? ""}`.trim(),
    });
    const patchPath = join(runDir, "change.patch");
    const change = await collectChange({
      checkout: projectDir,
      gitDir: run.gitDir,
      patchPath,
      maxBytes: LOCAL_LIMITS.maxPatchBytes,
    });
    if (change.kind === "none") {
      deps.log("INFO", "the build made no change; nothing to publish", ids);
      return body;
    }
    if (change.kind === "error") {
      deps.log("ERROR", "the build's change couldn't be collected", {
        ...ids,
        reason: change.reason,
      });
      return failed(change.reason);
    }
    deps.log("INFO", "change collected", { ...ids, bytes: change.bytes });
    phase = "publishing";
    await deps.repos.addWorktree(claimed.repo, run.projectSha, publishDir);
    worktrees.push({ repo: claimed.repo, path: publishDir });
    const base = await deps.repos.defaultBranch(claimed.repo);
    // Cancelled or ended meanwhile: publish nothing (the heartbeat contract).
    checkpoint();
    const granted = await deps.api.pushToken(claimed.runId, claimed.token);
    if (granted.kind !== "ok") {
      deps.log("ERROR", "push token refused; nothing published", {
        ...ids,
        reason: granted.reason,
        ...(granted.kind === "refused" ? { status: granted.status } : {}),
      });
      return failed(
        `The push token was refused (${granted.reason}), so the change was not pushed.`,
      );
    }
    const publishProfile = join(runDir, "publish.sb");
    await writeFile(
      publishProfile,
      seatbeltProfile({
        runnerHome: deps.home,
        read: [platformDir, patchPath],
        readWrite: [publishDir, run.repoCache],
        noKeychain: true,
      }),
      { mode: 0o600 },
    );
    const { result, log } = await publishChange({
      platformDir,
      publishDir,
      patchPath,
      runId: claimed.runId,
      branch: run.branch,
      repo: claimed.repo,
      base,
      projectId: run.ticket.projectId,
      ticketKey: run.ticket.key,
      ticketTitle: run.ticket.title,
      model: run.model,
      report: body,
      controlPlaneOrigin: deps.origin,
      pushToken: granted.token,
      gitBase: deps.gitBase,
      githubApi: deps.githubApi,
      confinement: deps.confinement,
      profilePath: publishProfile,
      timeoutMs: LOCAL_LIMITS.publishMinutes * 60_000,
    });
    for (const line of log) deps.log("INFO", "publish", { ...ids, line });
    if (result.kind === "refused") {
      deps.log("ERROR", "publish checks refused the change", { ...ids, reasons: result.reasons });
      return failed(
        `The publish checks refused the change, so nothing was pushed: ${result.reasons.join("; ")}.`,
      );
    }
    if (result.kind === "error") {
      deps.log("ERROR", "publish failed", { ...ids, reason: result.reason });
      return failed(`The publish step failed: ${result.reason}.`);
    }
    deps.log("INFO", "published", {
      ...ids,
      branch: result.branch,
      pullRequest: result.pullRequest,
    });
    return {
      ...body,
      branch: result.branch,
      pullRequest: result.pullRequest,
      toolingFiles: result.tooling,
    };
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
