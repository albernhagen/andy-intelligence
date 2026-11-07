import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRunProblem, gitTampering, verifyCheck } from "./executor-sandbox.mjs";

const COMMAND = "git update-index -q --refresh && printf %s abc > .executor-sandbox-check";
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
      use("Bash", { command: "printf %s abc > .executor-sandbox-check" }),
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

  it("GivenAPassingRun_WhenTheMarkerIsWrongOrMissing_ThenItFailsAndTheMarkerIsGone", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-"));
    const marker = join(dir, ".executor-sandbox-check");
    const messages = [use("Bash", { command: COMMAND }), result()];
    writeFileSync(marker, "abc");
    expect(verifyCheck({ messages, command: COMMAND, marker, nonce: "abc" })).toBe(null);
    expect(existsSync(marker)).toBe(false);
    writeFileSync(marker, "xyz");
    expect(verifyCheck({ messages, command: COMMAND, marker, nonce: "abc" })).toMatch(/marker/);
    expect(existsSync(marker)).toBe(false);
    expect(verifyCheck({ messages, command: COMMAND, marker, nonce: "abc" })).toMatch(/marker/);
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
