import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControlPlane } from "../src/api";
import { RepoCache } from "../src/git";
import { runLoop, type KeepAwake } from "../src/runner";
import { noConfinement, seatbelt, type Confinement } from "../src/seatbelt";
import { PUSH_TOKEN, SECRET, startFakeServer, type FakeServer, type FakeTask } from "./fake-server";
import {
  PLATFORM_REPO,
  PROJECT_REPO,
  WORKSPACE,
  makeEnv,
  memoryLogger,
  task,
  type Env,
  type StubConfig,
} from "./fixtures";

/**
 * AI-131 (ADR-0089 slice 5): the runner CLI's loop against a fake control plane, real git
 * worktrees and a stub `claude`. One contract second is 20 ms here.
 */

const MS_PER_SECOND = 20;
/** The real Seatbelt sandbox on macOS (the agent and platform child run under it); none on Linux CI. */
const CONFINEMENT = process.platform === "darwin" ? seatbelt : noConfinement;

let server: FakeServer;
let env: Env;

beforeEach(async () => {
  server = await startFakeServer();
});
afterEach(async () => {
  await server.close();
});

function loop(
  options: {
    stub?: StubConfig;
    tasks?: FakeTask[];
    secret?: string;
    idleMs?: number;
    signal?: AbortSignal;
    confinement?: Confinement;
    githubApi?: string;
    projectFiles?: Record<string, string>;
    pnpm?: string;
  } = {},
) {
  env = makeEnv(options.stub, options.projectFiles);
  server.queue.push(...(options.tasks ?? []));
  const log = memoryLogger();
  const awake: boolean[] = [];
  const keepAwake: KeepAwake = { set: (active) => awake.push(active) };
  const done = runLoop({
    api: new ControlPlane({ origin: server.origin, version: "test", retryDelayMs: 0 }),
    secret: options.secret ?? SECRET,
    runsAtOnce: 1,
    log,
    task: {
      repos: new RepoCache(env.home, env.gitBase),
      home: env.home,
      claudeCommand: env.claude,
      platformRepo: PLATFORM_REPO,
      origin: server.origin,
      gitBase: env.gitBase,
      githubApi: options.githubApi ?? "http://127.0.0.1:9",
      ...(options.pnpm ? { pnpmCommand: options.pnpm } : {}),
      confinement: options.confinement ?? CONFINEMENT,
    },
    keepAwake,
    signal: options.signal ?? new AbortController().signal,
    msPerSecond: MS_PER_SECOND,
    idleMs: options.idleMs ?? 400,
  });
  return { done, log, awake };
}

/** Answers `answer` from the n-th heartbeat in the agent phase on, once the stub has started. */
function afterAgentBeats(n: number, answer: "cancel" | 409) {
  let beats = 0;
  // Beats count only once the stub has recorded its call: under load it can start late.
  return (phase: string | undefined) =>
    phase === "agent" && env.calls().length > 0 && ++beats >= n ? answer : "ok";
}

const agentCalls = () => env.calls();
const workDir = (runId: string) => join(env.home, "work", runId);

describe("local-runner start", () => {
  it("GivenNoWork_WhenPolling_ThenItClaimsAtTheContractIntervalAndExitsAfterTheIdleLimit", async () => {
    server.pollSeconds = 5; // 100 ms here
    const { done } = loop({ idleMs: 450 });

    expect(await done).toBe("idle");
    const gaps = server.claims.slice(1).map((c, i) => c.at - server.claims[i]!.at);
    expect(server.claims.length).toBeGreaterThanOrEqual(3);
    expect(server.claims.length).toBeLessThanOrEqual(6);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(5 * MS_PER_SECOND - 5);
    expect(server.claims[0]!.body).toEqual({ version: "test" });
    expect(server.refused).toEqual([]);
  });

  it("GivenARefineClaim_WhenItRuns_ThenTheAgentRunsInItsOwnWorktreeWithHeartbeatsAndTheReportIsPosted", async () => {
    const t = task("refine");
    const output = { outcome: "ready", summary: "Ready." };
    const { done, awake } = loop({ tasks: [t], stub: { output, agentDelayMs: 150 } });

    expect(await done).toBe("idle");
    expect(server.refused).toEqual([]);
    expect(server.contexts).toEqual([t.claim.runId]);
    expect(server.reports).toHaveLength(1);
    const report = server.reports[0]!.body;
    expect(report).toMatchObject({
      status: "succeeded",
      summary: "Refined.",
      tokensIn: 105,
      tokensOut: 20,
      costUsd: 0.01,
      output,
      rateLimits: { rateLimitType: "five_hour", utilization: 0.2 },
      usage: { inputTokens: 100, outputTokens: 20, turns: 2 },
    });
    expect(server.heartbeats.length).toBeGreaterThan(0);
    expect(server.heartbeats.map((h) => h.body)).toContainEqual({ phase: "agent" });

    const [agent] = agentCalls();
    expect(agent!.cwd).toBe(join(workDir(t.claim.runId), "project"));
    // The platform's procedure first, then the run's prompt (ticket text).
    const procedure = readFileSync(join(WORKSPACE, "platform/procedures/refine.md"), "utf8");
    expect(agent!.stdin.startsWith(procedure.trimEnd())).toBe(true);
    expect(agent!.stdin).toContain(t.context.prompt);
    expect(agent!.args).toEqual(
      expect.arrayContaining(["--model", "claude-opus-5-5", "--max-turns", "30"]),
    );
    expect(agent!.args).toContain("--json-schema");
    // The agent's environment is an allowlist: neither credential reaches it.
    expect(agent!.envNames).toContain("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB");
    expect(JSON.stringify(env.calls())).not.toContain(SECRET);
    expect(JSON.stringify(env.calls())).not.toContain(t.claim.token);
    // A succeeded task leaves nothing behind; caffeinate was held only while it ran.
    expect(existsSync(workDir(t.claim.runId))).toBe(false);
    expect(awake).toEqual([true, false, false]);
  });

  it("GivenProjectAndLocalSettingsWithHooks_WhenTheAgentRuns_ThenNoneLoad", async () => {
    const t = task("plan");
    const { done } = loop({ tasks: [t] });
    expect(await done).toBe("idle");

    expect(existsSync(env.hookMarker)).toBe(false);
    expect(env.calls()).toHaveLength(1);
    for (const call of env.calls()) {
      const at = call.args.indexOf("--setting-sources");
      expect(at).toBeGreaterThan(-1);
      expect(call.args[at + 1]).toBe("");
      expect(call.args).toContain("--strict-mcp-config");
      expect(call.args).not.toContain("--dangerously-skip-permissions");
      expect(call.args[call.args.indexOf("--permission-mode") + 1]).toBe("default");
    }
    expect(server.reports[0]!.body.status).toBe("succeeded");
  });

  it("GivenAnAgentThatIgnoresTheSettingSourcesFlag_WhenItRuns_ThenTheHookMarkerShowsTheTestCanFail", async () => {
    const { done } = loop({ tasks: [task("refine")], stub: { ignoreSettingSources: true } });
    expect(await done).toBe("idle");
    expect(existsSync(env.hookMarker)).toBe(true);
  });

  it("GivenARefineClaim_WhenTheProfileIsWritten_ThenItIsThePlatformsRefineProfileWithHooksOff", async () => {
    const t = task("refine");
    const { done } = loop({ tasks: [t], stub: { agent: "fail" } });
    expect(await done).toBe("idle");

    const [agent] = agentCalls();
    const settingsPath = agent!.args[agent!.args.indexOf("--settings") + 1]!;
    expect(settingsPath.startsWith(workDir(t.claim.runId))).toBe(true);
    expect(settingsPath.startsWith(agent!.cwd)).toBe(false);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      disableAllHooks: boolean;
      permissions: { allow: string[]; deny: string[] };
    };
    expect(settings.disableAllHooks).toBe(true);
    expect(settings.permissions.allow).toEqual(["Read", "Glob", "Grep"]);
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(["Bash", "Edit", "Write"]));
    // CODEOWNERS paths become Edit denies anchored at the task's checkout.
    expect(settings.permissions.deny).toContain(`Edit(/${agent!.cwd}/docs/**)`);
  });

  it("GivenAFailedAgent_WhenItExits_ThenAFailedReportIsPostedAndTheWorktreeKept", async () => {
    const t = task("refine");
    const { done } = loop({ tasks: [t], stub: { agent: "fail" } });
    expect(await done).toBe("idle");

    expect(server.reports[0]!.body).toMatchObject({ status: "failed" });
    expect(existsSync(join(workDir(t.claim.runId), "project", "README.md"))).toBe(true);
  });

  it("GivenASyncClaim_WhenClaimed_ThenItIsRefusedWithAFailedReportAndNoAgent", async () => {
    const t = task("sync");
    const { done } = loop({ tasks: [t] });
    expect(await done).toBe("idle");

    expect(env.calls()).toEqual([]);
    expect(server.contexts).toEqual([]);
    expect(server.reports[0]!.body.status).toBe("failed");
    expect(server.reports[0]!.body.summary).toContain("stay on GitHub Actions");
    expect(existsSync(workDir(t.claim.runId))).toBe(false);
  });

  describe("build (AI-133)", () => {
    const remoteBranch = (runId: string) => {
      const remote = join(env.root, "remotes", `${PROJECT_REPO}.git`);
      try {
        return execFileSync("git", ["rev-parse", "--verify", `refs/heads/agent/AI-7/${runId}`], {
          cwd: remote,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          // Not the caller's environment: a git hook running the tests sets GIT_DIR.
          env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
        }).trim();
      } catch {
        return null;
      }
    };

    it("GivenABuildThatChangesAFile_WhenItFinishes_ThenTheRunBranchIsPushedAndThePrOpensAsTheBotAfterOnePushToken", async () => {
      const t = task("build");
      const { done, log } = loop({
        tasks: [t],
        stub: { edit: { "src/board.ts": "export const board = 1;\n" } },
        githubApi: server.origin,
      });
      expect(await done).toBe("idle");

      const runId = t.claim.runId;
      expect(server.refused).toEqual([]);
      expect(server.pushTokens).toEqual([{ runId, granted: true }]);
      expect(remoteBranch(runId)).toMatch(/^[0-9a-f]{40}$/);
      expect(server.pulls).toHaveLength(1);
      expect(server.pulls[0]).toMatchObject({
        repo: PROJECT_REPO,
        auth: `Bearer ${PUSH_TOKEN}`,
        body: { head: `agent/AI-7/${runId}`, base: "main", title: "AI-7: Show the board" },
      });
      expect(server.reports[0]!.body).toMatchObject({
        status: "succeeded",
        branch: `agent/AI-7/${runId}`,
        pullRequest: `https://github.com/${PROJECT_REPO}/pull/1`,
        toolingFiles: [],
      });
      // First the Bash check (Haiku, fixed prompt), then the agent.
      expect(agentCalls()).toHaveLength(2);
      const [check, agent] = agentCalls();
      expect(check!.args[check!.args.indexOf("--model") + 1]).toBe("haiku");
      expect(check!.stdin).not.toContain("Show the board");
      // A build's tools come from the profile, as on Actions: no read-only flags.
      expect(agent!.args).not.toContain("--allowedTools");
      expect(agent!.envNames).not.toContain("GITHUB_TOKEN");
      expect(agent!.envNames).not.toContain("SANDBOX_CHECK_NONCE");
      expect(
        existsSync(join(env.root, "home", "work", runId, "project", ".executor-sandbox-check")),
      ).toBe(false);
      const lines = JSON.stringify(log.lines);
      expect(lines).not.toContain(PUSH_TOKEN);
      expect(lines).not.toContain(t.claim.token);
      expect(existsSync(workDir(runId))).toBe(false);
    });

    it("GivenABuildThatChangesAProtectedPath_WhenItFinishes_ThenNothingIsPushedAndTheRunFails", async () => {
      const t = task("build");
      const { done } = loop({
        tasks: [t],
        stub: { edit: { "docs/plan.md": "# Plan\n" } },
        githubApi: server.origin,
      });
      expect(await done).toBe("idle");

      expect(remoteBranch(t.claim.runId)).toBeNull();
      expect(server.pulls).toEqual([]);
      expect(server.reports[0]!.body.status).toBe("failed");
      expect(server.reports[0]!.body.summary).toContain("docs/plan.md: protected");
    });

    it("GivenAPushTokenThatIsRefused_WhenTheBuildFinishes_ThenNothingIsPushedAndTheRunFails", async () => {
      server.refusePushToken = true;
      const t = task("build");
      const { done } = loop({
        tasks: [t],
        stub: { edit: { "src/board.ts": "x\n" } },
        githubApi: server.origin,
      });
      expect(await done).toBe("idle");

      expect(server.pushTokens).toEqual([{ runId: t.claim.runId, granted: false }]);
      expect(remoteBranch(t.claim.runId)).toBeNull();
      expect(server.reports[0]!.body.status).toBe("failed");
      expect(server.reports[0]!.body.summary).toContain("push token was refused");
    });

    it("GivenABuildThatChangesNothing_WhenItFinishes_ThenNoPushTokenIsAskedFor", async () => {
      const t = task("build");
      const { done } = loop({ tasks: [t], githubApi: server.origin });
      expect(await done).toBe("idle");

      expect(server.pushTokens).toEqual([]);
      expect(server.reports[0]!.body).toMatchObject({ status: "succeeded" });
      expect(server.reports[0]!.body.branch ?? null).toBeNull();
    });

    for (const mode of ["refuse", "open", "offline"] as const) {
      it(`GivenABashCheckThatSees${{ refuse: "BashRefused", open: "OpenNetwork", offline: "NoNetwork" }[mode]}_WhenABuildIsClaimed_ThenTheAgentDoesNotRunAndTheTaskFails`, async () => {
        const t = task("build");
        const { done } = loop({
          tasks: [t],
          stub: { sandboxCheck: mode, edit: { "src/board.ts": "x\n" } },
          githubApi: server.origin,
        });
        expect(await done).toBe("idle");

        expect(agentCalls()).toHaveLength(1);
        expect(server.pushTokens).toEqual([]);
        expect(server.reports[0]!.body.status).toBe("failed");
        expect(server.reports[0]!.body.summary).toContain("Bash sandbox check failed");
        expect(server.reports[0]!.body.summary).toContain(
          {
            refuse: "didn't run in Bash",
            open: "off the registry allowlist",
            offline: "couldn't reach the package registry",
          }[mode],
        );
      });
    }

    /** A `pnpm` stand-in: exits `code` after `seconds`. */
    const stubPnpm = (code: number, seconds = 0) => {
      const dir = mkdtempSync(join(tmpdir(), "lr-pnpm-"));
      const script = join(dir, "pnpm");
      writeFileSync(
        script,
        `#!/bin/sh\nsleep ${seconds}\necho 'install failed' >&2\nexit ${code}\n`,
      );
      chmodSync(script, 0o755);
      return script;
    };
    const lockfile = { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" };

    it("GivenAnInstallThatFails_WhenABuildIsClaimed_ThenTheAgentDoesNotRunAndTheTaskFails", async () => {
      const t = task("build");
      const { done } = loop({
        tasks: [t],
        projectFiles: lockfile,
        pnpm: stubPnpm(1),
        githubApi: server.origin,
      });
      expect(await done).toBe("idle");

      expect(agentCalls()).toEqual([]);
      expect(server.reports[0]!.body.status).toBe("failed");
      expect(server.reports[0]!.body.summary).toContain("Installing dependencies failed");
    });

    it("GivenACancelDuringTheInstall_WhenTheHeartbeatSaysSo_ThenTheTaskIsCancelledNotFailed", async () => {
      const t = task("build");
      let beats = 0;
      const { done } = loop({
        tasks: [
          { ...t, heartbeat: (phase) => (phase === "starting" && ++beats >= 30 ? "cancel" : "ok") },
        ],
        projectFiles: lockfile,
        pnpm: stubPnpm(0, 5),
        githubApi: server.origin,
      });
      expect(await done).toBe("idle");

      expect(agentCalls()).toEqual([]);
      expect(server.reports.map((r) => r.body.status)).toEqual(["cancelled"]);
    });

    it("GivenABuildContextWithoutTheRunsBranch_WhenClaimed_ThenTheAgentDoesNotRun", async () => {
      const t = task("build");
      t.context.branch = "agent/AI-7/someone-else";
      const { done } = loop({ tasks: [t], githubApi: server.origin });
      expect(await done).toBe("idle");

      expect(env.calls()).toEqual([]);
      expect(server.reports[0]!.body.status).toBe("failed");
    });
  });

  it("GivenASandboxCheckThatFails_WhenClaimed_ThenTheAgentDoesNotRunAndTheTaskFails", async () => {
    const t = task("refine");
    const failing: Confinement = {
      ...noConfinement,
      check: async () => "a file outside the checkout was readable",
    };
    const { done } = loop({ tasks: [t], confinement: failing });
    expect(await done).toBe("idle");

    expect(agentCalls()).toEqual([]);
    expect(server.reports[0]!.body.status).toBe("failed");
    expect(server.reports[0]!.body.summary).toContain("sandbox check failed");
    expect(server.reports[0]!.body.summary).toContain("outside the checkout");
  });

  it.runIf(process.platform === "darwin")(
    "GivenTheMacSandbox_WhenATaskRuns_ThenTheAgentRunsUnderSandboxExecWithTheTasksProfile",
    async () => {
      const t = task("refine");
      const { done } = loop({ tasks: [t], stub: { agent: "fail" }, confinement: seatbelt });
      expect(await done).toBe("idle");
      const profile = readFileSync(join(workDir(t.claim.runId), "agent.sb"), "utf8");
      expect(profile).toContain('(deny file-read-data file-write* (subpath "/Users")');
      expect(profile).toContain(
        `(allow file-read-data (subpath "${join(workDir(t.claim.runId), "project")}"))`,
      );
      expect(server.reports[0]!.body.status).toBe("failed");
      expect(agentCalls()).toHaveLength(1);
    },
  );

  it("GivenAHeartbeatThatAnswersCancel_WhenTheAgentRuns_ThenItStopsTheAgentAndReportsCancelled", async () => {
    const t = task("refine");
    const { done } = loop({
      tasks: [{ ...t, heartbeat: afterAgentBeats(15, "cancel") }],
      stub: { agent: "hang" },
    });
    expect(await done).toBe("idle");
    expect(agentCalls()).toHaveLength(1);
    expect(server.reports.map((r) => r.body.status)).toEqual(["cancelled"]);
    expect(existsSync(workDir(t.claim.runId))).toBe(false);
  });

  it("GivenAHeartbeatThatAnswers409_WhenTheAgentRuns_ThenItStopsTheAgentReportsNothingAndKeepsTheWorktree", async () => {
    const t = task("refine");
    const { done, log } = loop({
      tasks: [{ ...t, heartbeat: afterAgentBeats(15, 409) }],
      stub: { agent: "hang" },
    });
    expect(await done).toBe("idle");

    expect(agentCalls()).toHaveLength(1);
    expect(server.reports).toEqual([]);
    expect(existsSync(join(workDir(t.claim.runId), "project", "README.md"))).toBe(true);
    expect(log.lines.map((l) => l.message)).toContain(
      "agent task ended on the control plane; nothing reported, work kept",
    );
  });

  it("GivenATaskInFlight_WhenTheOnlySlotIsFull_ThenItDoesNotPollAndAShutdownReportsAFailure", async () => {
    const stop = new AbortController();
    const t = task("refine");
    const { done } = loop({ tasks: [t], stub: { agent: "hang" }, signal: stop.signal });
    await expect.poll(() => agentCalls().length, { timeout: 5000 }).toBe(1);
    const claims = server.claims.length;
    await new Promise((r) => setTimeout(r, 10 * MS_PER_SECOND));
    expect(server.claims.length).toBe(claims);

    stop.abort();
    expect(await done).toBe("stopped");
    expect(server.reports.map((r) => r.body.status)).toEqual(["failed"]);
    expect(server.reports[0]!.body.summary).toContain("stopped on its Mac");
  });

  it("GivenARevokedSecret_WhenClaiming_ThenTheRunnerExitsUnauthorizedWithoutLoggingTheSecret", async () => {
    server.revoked = true;
    const { done, log } = loop();
    expect(await done).toBe("unauthorized");
    expect(JSON.stringify(log.lines)).not.toContain(SECRET);
  });

  it("GivenAnyTask_WhenItRuns_ThenNoLogLineHoldsTheSecretTheTokenOrTheTicketText", async () => {
    const t = task("refine");
    const { done, log } = loop({ tasks: [t] });
    expect(await done).toBe("idle");
    const logged = JSON.stringify(log.lines);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(t.claim.token);
    expect(logged).not.toContain(t.context.prompt);
  });
});
