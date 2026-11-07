import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRunProblem, factsProblem, gitTampering, verifyCheck } from "./executor-sandbox.mjs";

const COMMAND = "git update-index -q --refresh && env | cut -d= -f1 > .executor-sandbox-check";
const use = (name, input, id = "t1") => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const result = (isError = false, id = "t1") => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: "" }] },
});
const done = { type: "result", subtype: "success" };

describe("sandbox check run", () => {
  it("GivenTheExactCommandRanOnceWithoutError_WhenChecked_ThenItPasses", () => {
    expect(checkRunProblem([use("Bash", { command: COMMAND }), result(), done], COMMAND)).toBe(
      null,
    );
  });

  it("GivenTheModelDroppedAClause_WhenChecked_ThenItFails", () => {
    const messages = [
      use("Bash", { command: "env | cut -d= -f1 > .executor-sandbox-check" }),
      result(),
    ];
    expect(checkRunProblem(messages, COMMAND)).toBe("the check ran a different command");
  });

  it("GivenTheBashCallFailedInTheSandbox_WhenChecked_ThenItFails", () => {
    expect(checkRunProblem([use("Bash", { command: COMMAND }), result(true)], COMMAND)).toBe(
      "the Bash call failed in the sandbox",
    );
  });

  it("GivenTheModelWroteTheMarkerWithWrite_WhenChecked_ThenItFails", () => {
    const messages = [
      use("Write", { file_path: ".executor-sandbox-check", content: "abc" }),
      result(),
    ];
    expect(checkRunProblem(messages, COMMAND)).toBe("the check used Write, not only Bash");
  });

  it("GivenNoToolCallOrTwoBashCalls_WhenChecked_ThenItFails", () => {
    expect(checkRunProblem([done], COMMAND)).toBe("the check made 0 Bash calls, not 1");
    const twice = [
      use("Bash", { command: COMMAND }),
      result(),
      use("Bash", { command: COMMAND }, "t2"),
      result(false, "t2"),
    ];
    expect(checkRunProblem(twice, COMMAND)).toBe("the check made 2 Bash calls, not 1");
  });

  it("GivenNoExecutionLog_WhenChecked_ThenItFails", () => {
    expect(checkRunProblem(null, COMMAND)).toBe("no execution log");
  });
});

const HOST_PID1 = "/sbin/init splash ";
const facts = (over = {}) =>
  [
    `nonce=${over.nonce ?? "n0nce"}`,
    `uid=${over.uid ?? "1001"}`,
    `pid1=${over.pid1 ?? "bwrap --new-session bash "}`,
    ...(over.env ?? ["PATH", "HOME", "TMPDIR"]).map((n) => `env=${n}`),
    "",
  ].join("\n");
const opts = { nonce: "n0nce", hostPid1: HOST_PID1 };

describe("sandbox check facts", () => {
  it("GivenTheNonceANonRootUidItsOwnPid1AndNoCredentials_WhenChecked_ThenItPasses", () => {
    expect(factsProblem(facts(), opts)).toBe(null);
  });

  it("GivenACredentialVariableReachedTheSandbox_WhenChecked_ThenItFailsNamingIt", () => {
    const text = facts({ env: ["PATH", "GITHUB_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"] });
    expect(factsProblem(text, opts)).toBe(
      "credential variables reached the sandbox: CLAUDE_CODE_OAUTH_TOKEN, GITHUB_TOKEN",
    );
  });

  it("GivenTheRunnersOwnPid1OrRoot_WhenChecked_ThenItFails", () => {
    expect(factsProblem(facts({ pid1: HOST_PID1 }), opts)).toMatch(/runner's own/);
    expect(factsProblem(facts({ uid: "0" }), opts)).toBe("uid is 0");
  });

  it("GivenAWrongNonceNoFileOrNoEnvNames_WhenChecked_ThenItFails", () => {
    expect(factsProblem(facts({ nonce: "guess" }), opts)).toBe("the nonce is missing or wrong");
    expect(factsProblem(null, opts)).toBe("the command wrote no facts file");
    expect(factsProblem(facts({ env: [] }), opts)).toBe("no environment names");
  });

  it("GivenAPassingRun_WhenTheFactsFileIsGoodOrMissing_ThenTheResultFollowsAndTheMarkerIsGone", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-"));
    const marker = join(dir, ".executor-sandbox-check");
    const messages = [use("Bash", { command: COMMAND }), result()];
    const args = { messages, command: COMMAND, marker, ...opts };
    writeFileSync(marker, facts());
    expect(verifyCheck(args)).toBe(null);
    expect(existsSync(marker)).toBe(false);
    expect(verifyCheck(args)).toBe("the command wrote no facts file");
  });
});

describe("sandbox check marker", () => {
  it("GivenTheMarkerIsASymlinkToGoodFacts_WhenVerified_ThenItIsNotFollowed", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-"));
    const target = join(dir, "elsewhere");
    writeFileSync(target, facts());
    const marker = join(dir, ".executor-sandbox-check");
    symlinkSync(target, marker);
    const messages = [use("Bash", { command: COMMAND }), result()];
    expect(verifyCheck({ messages, command: COMMAND, marker, ...opts })).toBe(
      "the command wrote no facts file",
    );
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(target)).toBe(true);
  });
});

describe("git tampering", () => {
  const repo = () => {
    const root = mkdtempSync(join(tmpdir(), "git-"));
    for (const side of ["pristine", "live"]) {
      mkdirSync(join(root, side, "hooks"), { recursive: true });
      mkdirSync(join(root, side, "info"), { recursive: true });
      mkdirSync(join(root, side, "objects", "info"), { recursive: true });
      writeFileSync(join(root, side, "config"), "[core]\n");
      writeFileSync(join(root, side, "info", "exclude"), "");
      writeFileSync(join(root, side, "index"), side);
    }
    return { pristine: join(root, "pristine"), live: join(root, "live"), root };
  };

  it("GivenOnlyTheIndexAndRefsChanged_WhenChecked_ThenNothingIsReported", () => {
    const r = repo();
    mkdirSync(join(r.live, "refs", "heads"), { recursive: true });
    writeFileSync(join(r.live, "refs", "heads", "x"), "0000\n");
    expect(gitTampering(r)).toEqual([]);
  });

  it("GivenAPlantedCommondirAttributesAndAlternates_WhenChecked_ThenEachIsReported", () => {
    const r = repo();
    writeFileSync(join(r.live, "commondir"), "/tmp/agent/evil\n");
    writeFileSync(join(r.live, "info", "attributes"), "* filter=x\n");
    writeFileSync(join(r.live, "objects", "info", "alternates"), "/tmp/agent/objects\n");
    expect(gitTampering(r)).toEqual(["commondir", "info", "objects/info/alternates"]);
  });

  it("GivenConfigReplacedBySymlinkOrAHookAdded_WhenChecked_ThenBothAreReported", () => {
    const r = repo();
    writeFileSync(join(r.root, "evil"), "[core]\n");
    const cfg = join(r.live, "config");
    rmSync(cfg);
    symlinkSync(join(r.root, "evil"), cfg);
    writeFileSync(join(r.live, "hooks", "post-checkout"), "#!/bin/sh\n");
    expect(gitTampering(r)).toEqual(["config", "hooks"]);
  });

  it("GivenGitReplacedByASymlink_WhenChecked_ThenGitItselfIsReported", () => {
    const r = repo();
    const live = join(r.root, "link");
    symlinkSync(r.pristine, live);
    expect(gitTampering({ pristine: r.pristine, live })).toEqual([".git"]);
  });
});
