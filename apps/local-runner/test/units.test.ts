import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_REPORT_MAX_BYTES, type RunContextResponse } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { agentArgs, agentEnv, parseStream } from "../src/agent";
import { checkContext, fitReport } from "../src/api";
import { checkSettings } from "../src/check-settings";
import { KEYCHAIN_SERVICE, controlPlaneOrigin, checkRepo } from "../src/config";
import { login, logout, readSecret } from "../src/keychain";
import { loadPlatform } from "../src/platform";
import { pruneWork } from "../src/runner";
import { factsProblem } from "../src/sandbox-check";
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
      allowedTools: "Read",
      disallowedTools: "Bash",
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

describe("sandbox facts", () => {
  const ok = "nonce=abc\noutside=denied\nenv=PATH\nenv=HOME\n";
  const input = { nonce: "abc", probeExists: false, credentialVars: ["GH_TOKEN"] };

  it("GivenFactsFromAWorkingSandbox_WhenChecked_ThenThereIsNoProblem", () => {
    expect(factsProblem(ok, input)).toBeNull();
  });

  it("GivenFactsThatShowNoSandbox_WhenChecked_ThenEachIsAProblem", () => {
    expect(factsProblem(null, input)).toMatch(/no facts/);
    expect(factsProblem(ok.replace("abc", "xyz"), input)).toMatch(/nonce/);
    expect(factsProblem(ok.replace("denied", "written"), input)).toMatch(/outside/);
    expect(factsProblem(ok, { ...input, probeExists: true })).toMatch(/outside/);
    expect(factsProblem(`${ok}env=GH_TOKEN\n`, input)).toMatch(/GH_TOKEN/);
    expect(factsProblem(`${ok}env=RUN_TOKEN\n`, input)).toMatch(/RUN_TOKEN/);
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
  const platform = () => loadPlatform(WORKSPACE);

  it("GivenAnAgentThatHonoursSettingSources_WhenChecked_ThenItPasses", async () => {
    const env = makeEnv();
    const problem = await checkSettings({
      platform: await platform(),
      claudeCommand: env.claude,
      dir: join(env.root, "check"),
    });
    expect(problem).toBeNull();
  });

  it("GivenAnAgentThatLoadsProjectSettings_WhenChecked_ThenItFailsNamingTheSources", async () => {
    const env = makeEnv({ ignoreSettingSources: true });
    const problem = await checkSettings({
      platform: await platform(),
      claudeCommand: env.claude,
      dir: join(env.root, "check"),
    });
    expect(problem).toBe("hooks from the project and local settings ran");
  });
});
