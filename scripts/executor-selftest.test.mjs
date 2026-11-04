import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSelfTest, countDenials } from "./executor-selftest.mjs";

const TOKEN = "SELFTEST-0123456789abcdef";
const denied = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "DENIED",
  permission_denials: [
    { tool_name: "Read", tool_use_id: "t1", tool_input: { file_path: ".env.selftest" } },
  ],
};
const session = (result, extra = []) => [{ type: "system" }, ...extra, result];

describe("checkSelfTest", () => {
  it("GivenTheReadWasDenied_WhenChecked_ThenOk", () => {
    expect(
      checkSelfTest({ outcome: "success", messages: session(denied), forbidden: TOKEN }),
    ).toEqual({ ok: true, reason: "permission profile enforced (1 denied tool call)" });
  });

  it("GivenOnlyADenialCount_WhenChecked_ThenOk", () => {
    const result = { ...denied, permission_denials: undefined, permission_denials_count: 2 };
    expect(checkSelfTest({ outcome: "success", messages: session(result) }).ok).toBe(true);
  });

  it("GivenNoDenial_WhenChecked_ThenFailsClosed", () => {
    const result = { ...denied, result: "READ", permission_denials: [] };
    expect(
      checkSelfTest({ outcome: "success", messages: session(result), forbidden: TOKEN }),
    ).toEqual({
      ok: false,
      reason: "permission profile not proven: the self-test read was not denied",
    });
  });

  it("GivenTheFileContentsInTheSession_WhenChecked_ThenFailsEvenWithADenial", () => {
    const leak = {
      type: "user",
      message: { content: [{ type: "tool_result", content: `${TOKEN}\n` }] },
    };
    const check = checkSelfTest({
      outcome: "success",
      messages: session(denied, [leak]),
      forbidden: `${TOKEN}\n`,
    });
    expect(check).toEqual({
      ok: false,
      reason: "permission profile not enforced: the decoy file was read",
    });
  });

  it("GivenNoExecutionFile_WhenChecked_ThenFailsClosed", () => {
    expect(checkSelfTest({ outcome: "failure", messages: null })).toEqual({
      ok: false,
      reason: "permission self-test did not run (step failure)",
    });
  });

  it("GivenAGarbledResult_WhenCounted_ThenZero", () => {
    expect(countDenials(undefined)).toBe(0);
    expect(countDenials({ permission_denials_count: "3" })).toBe(0);
  });
});

describe("executor-selftest CLI", () => {
  it("GivenADeniedSessionFile_WhenRun_ThenPrintsOk", () => {
    const dir = mkdtempSync(join(tmpdir(), "selftest-"));
    const file = join(dir, "exec.json");
    writeFileSync(file, JSON.stringify(session(denied)));
    const out = spawnSync(process.execPath, ["scripts/executor-selftest.mjs"], {
      env: { ...process.env, OUTCOME: "success", EXECUTION_FILE: file, FORBIDDEN: TOKEN },
      encoding: "utf8",
    });
    expect(JSON.parse(out.stdout)).toMatchObject({ ok: true });
  });
});
