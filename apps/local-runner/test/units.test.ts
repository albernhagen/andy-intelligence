import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_REPORT_MAX_BYTES, type RunContextResponse } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { agentArgs, agentEnv, parseStream } from "../src/agent";
import { BASH_CHECK_COMMAND, BASH_CHECK_PROMPT, parseFacts, toolCalls } from "../src/bash-check";
import { checkContext, fitReport } from "../src/api";
import { checkSettings } from "../src/check-settings";
import { KEYCHAIN_SERVICE, controlPlaneOrigin, checkRepo } from "../src/config";
import { login, logout, readSecret } from "../src/keychain";
import { checkAgentSettings, loadPlatform } from "../src/platform";
import { pruneWork } from "../src/runner";
import { noConfinement, seatbelt, seatbeltProfile } from "../src/seatbelt";
import {
  acquireRunnerLock,
  cleanLeftoverAgents,
  killAllAgents,
  startWatchdog,
  startTime,
  track,
  writePidFile,
} from "../src/processes";
import { SECRET } from "./fake-server";
import { WORKSPACE, makeEnv } from "./fixtures";

/** A `security` stand-in: a JSON file next to it is the "Keychain"; argv is logged. */
function stubSecurity() {
  const dir = mkdtempSync(join(tmpdir(), "lr-security-"));
  const script = join(dir, "security");
  writeFileSync(
    script,
    `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const dir = path.dirname(process.argv[1]);
const store = path.join(dir, "keychain.json");
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, "argv.log"), JSON.stringify(args) + "\\n");
const items = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, "utf8")) : {};
const key = args[args.indexOf("-s") + 1] + "|" + args[args.indexOf("-a") + 1];
if (args[0] === "add-generic-password") {
  items[key] = fs.readFileSync(0, "utf8").split("\\n")[0];
  fs.writeFileSync(store, JSON.stringify(items));
} else if (args[0] === "find-generic-password") {
  if (!(key in items)) process.exit(44);
  process.stdout.write(items[key] + "\\n");
} else if (args[0] === "delete-generic-password") {
  if (!(key in items)) process.exit(44);
  delete items[key];
  fs.writeFileSync(store, JSON.stringify(items));
}
`,
  );
  chmodSync(script, 0o755);
  const before = new Set(readdirSync(dir));
  return {
    dir,
    script,
    items: () =>
      JSON.parse(readFileSync(join(dir, "keychain.json"), "utf8")) as Record<string, string>,
    argv: () => readFileSync(join(dir, "argv.log"), "utf8"),
    newFiles: () => readdirSync(dir).filter((f) => !before.has(f)),
  };
}

const ACCOUNT = "https://ai.example.com";

describe("local-runner login", () => {
  it("GivenARunnerSecret_WhenLoggingIn_ThenItIsInTheKeychainAndNowhereElse", async () => {
    const security = stubSecurity();
    const home = mkdtempSync(join(tmpdir(), "lr-home-"));
    await login(ACCOUNT, { securityCommand: security.script, promptInput: `${SECRET}\n` });

    expect(security.items()).toEqual({ [`${KEYCHAIN_SERVICE}|${ACCOUNT}`]: SECRET });
    // Never on a command line (visible to `ps`), never in a file of the runner's.
    expect(security.argv()).not.toContain(SECRET);
    expect(security.argv().split("\n")[0]).toMatch(/"-w"\]$/);
    expect(security.newFiles().sort()).toEqual(["argv.log", "keychain.json"]);
    expect(readdirSync(home)).toEqual([]);
    expect(await readSecret(ACCOUNT, { securityCommand: security.script })).toBe(SECRET);
  });

  it("GivenSomethingThatIsNotARunnerSecret_WhenLoggingIn_ThenItIsRefusedAndDeleted", async () => {
    const security = stubSecurity();
    await expect(
      login(ACCOUNT, { securityCommand: security.script, promptInput: "hunter2\n" }),
    ).rejects.toThrow(/isn't a runner secret/);
    expect(security.items()).toEqual({});
  });

  it("GivenAStoredSecret_WhenLoggingOut_ThenItIsDeleted", async () => {
    const security = stubSecurity();
    const options = { securityCommand: security.script };
    await login(ACCOUNT, { ...options, promptInput: `${SECRET}\n` });
    expect(await logout(ACCOUNT, options)).toBe(true);
    expect(await readSecret(ACCOUNT, options)).toBeNull();
    expect(await logout(ACCOUNT, options)).toBe(false);
  });
});

describe("config", () => {
  it("GivenAnHttpUrl_WhenItIsNotLoopback_ThenItIsRefused", () => {
    expect(() => controlPlaneOrigin("http://ai.example.com")).toThrow(/https/);
    expect(controlPlaneOrigin("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(controlPlaneOrigin("https://ai.example.com/")).toBe("https://ai.example.com");
    expect(() => controlPlaneOrigin("https://ai.example.com/api")).toThrow(/origin/);
  });

  it("GivenARepoName_WhenItCouldEscapeTheCache_ThenItIsRefused", () => {
    expect(checkRepo("albernhagen/andy-intelligence")).toBe("albernhagen/andy-intelligence");
    expect(() => checkRepo("../etc")).toThrow();
    expect(() => checkRepo("a/../b")).toThrow();
    expect(() => checkRepo("a/b/c")).toThrow();
  });
});

describe("agent arguments", () => {
  it("GivenAnyStep_WhenBuildingTheArguments_ThenSettingSourcesAreOffAndTheProfileComesWithSettings", () => {
    const args = agentArgs({
      model: "m",
      maxTurns: 3,
      settingsPath: "/x/settings.json",
      schema: '{"type":"object"}',
      tools: { allowed: "Read", disallowed: "Bash" },
    });
    expect(
      args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 2),
    ).toEqual(["--setting-sources", ""]);
    expect(args.slice(args.indexOf("--settings"), args.indexOf("--settings") + 2)).toEqual([
      "--settings",
      "/x/settings.json",
    ]);
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("GivenTheRunnersEnvironment_WhenBuildingTheAgents_ThenOnlyTheAllowlistPasses", () => {
    process.env.LOCAL_RUNNER_TEST_SECRET = "nope";
    try {
      const env = agentEnv();
      expect(env.LOCAL_RUNNER_TEST_SECRET).toBeUndefined();
      expect(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe("1");
    } finally {
      delete process.env.LOCAL_RUNNER_TEST_SECRET;
    }
  });

  it("GivenAStreamWithAPartialLastLine_WhenParsing_ThenWholeMessagesAreKept", () => {
    expect(parseStream('{"type":"system"}\nnot json\n{"type":"result"}\n{"type":"assi')).toEqual([
      { type: "system" },
      { type: "result" },
    ]);
    expect(parseStream("")).toBeNull();
  });
});

describe("control plane answers", () => {
  const context: RunContextResponse = {
    runId: "r1",
    step: "refine",
    model: "claude-opus-5-5",
    maxTurns: 30,
    prompt: "p",
    ticket: null,
    branch: null,
    sync: null,
  };

  it("GivenAContextOutsideTheExecutorsBounds_WhenChecked_ThenItIsRefused", () => {
    expect(checkContext(context, "r1")).toEqual(context);
    expect(() => checkContext(context, "r2")).toThrow(/another/);
    expect(() => checkContext({ ...context, maxTurns: 201 }, "r1")).toThrow(/cap/);
    expect(() => checkContext({ ...context, model: "x; rm -rf /" }, "r1")).toThrow(/model/);
  });

  it("GivenAReportOverTheCap_WhenFitted_ThenTheOutputGoesFirst", () => {
    const big = {
      status: "succeeded" as const,
      summary: "s",
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0,
    };
    const fitted = fitReport({ ...big, output: { blob: "x".repeat(RUN_REPORT_MAX_BYTES) } });
    expect(fitted.output).toBeUndefined();
    expect(fitted.summary).toBe("s");
    expect(fitReport(big)).toEqual(big);
  });
});

describe("kept work directories", () => {
  it("GivenMoreThanTheCap_WhenPruned_ThenTheNewestAreKept", () => {
    const home = mkdtempSync(join(tmpdir(), "lr-prune-"));
    for (let i = 0; i < 4; i += 1) {
      const dir = join(home, "work", `run-${i}`);
      mkdirSync(dir, { recursive: true });
      utimesSync(dir, 1000 + i, 1000 + i);
    }
    expect(pruneWork(home, 2).sort()).toEqual(["run-0", "run-1"]);
    expect(readdirSync(join(home, "work")).sort()).toEqual(["run-2", "run-3"]);
  });
});

describe("local-runner check-settings", () => {
  const platform = () =>
    loadPlatform({ root: WORKSPACE, confinement: noConfinement, profilePath: "/nonexistent" });

  it("GivenAnAgentThatHonoursSettingSources_WhenChecked_ThenItPasses", async () => {
    const env = makeEnv();
    const problem = await checkSettings({
      platform: platform(),
      claudeCommand: env.claude,
      dir: join(env.home, "check-settings", "scratch"),
      runnerHome: env.home,
      confinement: process.platform === "darwin" ? seatbelt : noConfinement,
    });
    expect(problem).toBeNull();
  });

  it("GivenAnAgentThatLoadsProjectSettings_WhenChecked_ThenItFailsNamingTheSources", async () => {
    const env = makeEnv({ ignoreSettingSources: true });
    const problem = await checkSettings({
      platform: platform(),
      claudeCommand: env.claude,
      dir: join(env.home, "check-settings", "scratch"),
      runnerHome: env.home,
      confinement: process.platform === "darwin" ? seatbelt : noConfinement,
    });
    expect(problem).toBe("hooks from the project and local settings ran");
  });
});

describe("seatbelt profile", () => {
  it("GivenATask_WhenBuildingTheAgentsProfile_ThenHomesAndTheRunnerDirAreDeniedAndOnlyTheCheckoutReopened", () => {
    const profile = seatbeltProfile({
      runnerHome: "/opt/runner-home",
      read: ["/opt/runner-home/work/r1/project"],
      claude: { command: "/bin/sh" },
    });
    const lines = profile.split("\n");
    const deny = lines.findIndex((l) => l.startsWith("(deny file-read-data file-write*"));
    const allow = lines.indexOf(
      '(allow file-read-data (subpath "/opt/runner-home/work/r1/project"))',
    );
    expect(lines[deny]).toContain('(subpath "/Users")');
    expect(lines[deny]).toContain('(subpath "/opt/runner-home")');
    expect(allow).toBeGreaterThan(deny); // later rules win
    expect(profile).not.toContain("(deny network*)");
  });

  it("GivenThePlatformChild_WhenBuildingItsProfile_ThenItIsOfflineAndWithoutTheKeychain", () => {
    const profile = seatbeltProfile({ runnerHome: "/opt/h", read: ["/opt/h/p"], offline: true });
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain('(global-name "com.apple.SecurityServer")');
  });

  it("GivenAPathWithAQuote_WhenBuildingAProfile_ThenItIsRefused", () => {
    expect(() => seatbeltProfile({ runnerHome: '/opt/a"b', read: [] })).toThrow(/not allowed/);
  });

  it.runIf(process.platform === "darwin")(
    "GivenTheRealSandbox_WhenChecked_ThenTheAgentsProfilePassesAndAnOpenProfileFails",
    async () => {
      const home = realpathSync(mkdtempSync(join(tmpdir(), "lr-sb-")));
      const runDir = join(home, "work", "r1");
      const checkout = join(runDir, "project");
      mkdirSync(checkout, { recursive: true });
      writeFileSync(join(checkout, "README.md"), "x");
      const good = join(home, "good.sb");
      writeFileSync(
        good,
        seatbeltProfile({ runnerHome: home, read: [checkout], claude: { command: "/bin/sh" } }),
      );
      expect(await seatbelt.check({ profilePath: good, checkout, runDir })).toBeNull();
      const open = join(home, "open.sb");
      writeFileSync(open, "(version 1)\n(allow default)\n");
      expect(await seatbelt.check({ profilePath: open, checkout, runDir })).toBe(
        "a file outside the checkout was readable",
      );
    },
  );
});

describe("one runner per home", () => {
  it("GivenALiveRunnerHoldingTheLock_WhenAnotherStarts_ThenItIsRefused", async () => {
    const home = mkdtempSync(join(tmpdir(), "lr-lock-"));
    const first = await acquireRunnerLock(home);
    expect("release" in first).toBe(true);
    expect(await acquireRunnerLock(home)).toEqual({ heldBy: process.pid });
    if ("release" in first) first.release();
    expect(existsSync(join(home, "runner.lock"))).toBe(false);
  });

  it("GivenAStaleLockOfADeadRunner_WhenStarting_ThenItIsTakenOver", async () => {
    const home = mkdtempSync(join(tmpdir(), "lr-stale-"));
    writeFileSync(join(home, "runner.lock"), JSON.stringify({ pid: 999_999, started: "x" }));
    const lock = await acquireRunnerLock(home);
    expect("release" in lock).toBe(true);
    expect(JSON.parse(readFileSync(join(home, "runner.lock"), "utf8")).pid).toBe(process.pid);
    if ("release" in lock) lock.release();
  });
});

describe("platform settings", () => {
  const ok = { disableAllHooks: true, permissions: { allow: [], deny: [] }, allowedMcpServers: [] };

  it("GivenThePlatformsOwnProfile_WhenChecked_ThenEveryStepPasses", async () => {
    const platform = loadPlatform({
      root: WORKSPACE,
      confinement: noConfinement,
      profilePath: "/x",
    });
    for (const step of ["refine", "plan", "build"]) {
      await expect(platform.settings(step, WORKSPACE)).resolves.toMatchObject({
        disableAllHooks: true,
      });
    }
  });

  it("GivenSettingsWithAHookAHelperOrHooksOn_WhenChecked_ThenTheyAreRefused", () => {
    expect(checkAgentSettings(ok)).toEqual(ok);
    expect(() => checkAgentSettings({ ...ok, hooks: {} })).toThrow(/hooks/);
    expect(() => checkAgentSettings({ ...ok, apiKeyHelper: "sh x" })).toThrow(/apiKeyHelper/);
    expect(() => checkAgentSettings({ ...ok, env: { A: "1" } })).toThrow(/env/);
    expect(() => checkAgentSettings({ ...ok, disableAllHooks: false })).toThrow(/hooks off/);
    expect(() => checkAgentSettings({ ...ok, allowedMcpServers: [{ serverName: "x" }] })).toThrow(
      /MCP/,
    );
  });
});

describe("agents never outlive the runner", () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const detachedSleep = () => {
    const child = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
    child.unref();
    return child.pid!;
  };

  it("GivenLiveAgents_WhenTheRunnerExits_ThenKillAllAgentsKillsTheirGroups", async () => {
    const pid = detachedSleep();
    track(pid);
    expect(killAllAgents()).toBe(1);
    await expect.poll(() => alive(pid), { timeout: 3000 }).toBe(false);
  });

  it("GivenARunnerThatIsKilled_WhenItsAgentIsStillRunning_ThenTheWatchdogKillsTheAgent", async () => {
    const runner = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
    runner.unref();
    const agent = detachedSleep();
    startWatchdog(agent, runner.pid!);
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(agent)).toBe(true);
    process.kill(runner.pid!, "SIGKILL");
    await expect.poll(() => alive(agent), { timeout: 8000, interval: 200 }).toBe(false);
  }, 15_000);

  const deadRunner = { pid: 999_999, started: "Mon Jan  1 00:00:00 2001" };
  const pidFile = (home: string, run: string, record: unknown) => {
    mkdirSync(join(home, "work", run), { recursive: true });
    writeFileSync(join(home, "work", run, "agent.pid"), JSON.stringify(record));
  };

  it("GivenALeftoverAgentOfADeadRunner_WhenTheRunnerStarts_ThenOnlyAMatchingLiveProcessIsKilled", async () => {
    const home = mkdtempSync(join(tmpdir(), "lr-left-"));
    const live = detachedSleep();
    const other = detachedSleep();
    pidFile(home, "run-a", { pgid: live, started: await startTime(live), runner: deadRunner });
    // A reused pid: same number, another start time, never killed.
    pidFile(home, "run-b", {
      pgid: other,
      started: "Mon Jan  1 00:00:00 2001",
      runner: deadRunner,
    });

    expect(await cleanLeftoverAgents(home)).toEqual(["run-a"]);
    await expect.poll(() => alive(live), { timeout: 3000 }).toBe(false);
    expect(alive(other)).toBe(true);
    process.kill(-other, "SIGKILL");
  });

  it("GivenAnAgentOfALiveRunner_WhenAnotherRunnerCleansUp_ThenItIsNotTouched", async () => {
    const home = mkdtempSync(join(tmpdir(), "lr-live-"));
    const agent = detachedSleep();
    // writePidFile records this process as the owning runner, which is alive.
    mkdirSync(join(home, "work", "run-a"), { recursive: true });
    await writePidFile(join(home, "work", "run-a", "agent.pid"), agent);

    expect(await cleanLeftoverAgents(home)).toEqual([]);
    expect(alive(agent)).toBe(true);
    expect(existsSync(join(home, "work", "run-a", "agent.pid"))).toBe(true);
    process.kill(-agent, "SIGKILL");
  });
});

describe("Bash check (AI-133)", () => {
  it("GivenAStream_WhenItsToolCallsAreRead_ThenOnlyToolUsesCountWithTheirCommands", () => {
    const messages = [
      { type: "system", subtype: "init" },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "ok" },
            { type: "tool_use", name: "Bash", input: { command: BASH_CHECK_COMMAND } },
          ],
        },
      },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: {} }] } },
    ];
    expect(toolCalls(messages)).toEqual([
      { name: "Bash", command: BASH_CHECK_COMMAND },
      { name: "Read", command: undefined },
    ]);
    expect(toolCalls(null)).toEqual([]);
  });

  it("GivenTheFactsFile_WhenParsed_ThenKeyValuePairsAndTheCommandReadsNoTicketText", () => {
    expect(parseFacts("nonce=abc\ncanary=denied\nnet=blocked\njunk\n")).toEqual({
      nonce: "abc",
      canary: "denied",
      net: "blocked",
    });
    expect(BASH_CHECK_PROMPT.endsWith(BASH_CHECK_COMMAND)).toBe(true);
    expect(BASH_CHECK_COMMAND).not.toContain("SANDBOX_CHECK_NONCE=");
  });
});

describe("build scratch isolation (AI-133)", () => {
  it("GivenAScratchRoot_WhenTheProfileIsWritten_ThenTheRootIsDeniedAndOnlyTheTasksOwnDirectoryReopened", () => {
    const text = seatbeltProfile({
      runnerHome: "/nonexistent/runner",
      read: [],
      scratch: { root: "/nonexistent/agent", own: "/nonexistent/agent/run-1" },
    });
    const lines = text.split("\n");
    const deny = lines.findIndex(
      (l) => l === '(deny file-read-data file-write* (subpath "/nonexistent/agent"))',
    );
    const allow = lines.findIndex(
      (l) => l === '(allow file-read-data file-write* (subpath "/nonexistent/agent/run-1"))',
    );
    expect(deny).toBeGreaterThan(-1);
    expect(allow).toBeGreaterThan(deny);
  });
});
