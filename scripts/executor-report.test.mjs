import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_SUMMARY, buildReport, readMessages, truncate } from "./executor-report.mjs";

const resultMessage = (extra = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Refined the ticket.",
  total_cost_usd: 0.42,
  usage: {
    input_tokens: 100,
    cache_read_input_tokens: 1000,
    cache_creation_input_tokens: 50,
    output_tokens: 200,
  },
  ...extra,
});
const messages = (extra) => [{ type: "system" }, { type: "assistant" }, resultMessage(extra)];

describe("buildReport", () => {
  it("GivenSuccessWithUsage_WhenBuilt_ThenSucceededWithTokensAndCost", () => {
    expect(buildReport({ outcome: "success", messages: messages() })).toEqual({
      status: "succeeded",
      summary: "Refined the ticket.",
      tokensIn: 1150,
      tokensOut: 200,
      costUsd: 0.42,
    });
  });

  it("GivenFailureOutcome_WhenBuilt_ThenFailedButKeepsUsage", () => {
    const report = buildReport({
      outcome: "failure",
      messages: messages({ subtype: "error_max_turns", is_error: true, result: undefined }),
    });
    expect(report.status).toBe("failed");
    expect(report.summary).toBe("Agent stopped: error_max_turns");
    expect(report.tokensIn).toBe(1150);
  });

  it("GivenSuccessOutcomeButErrorResult_WhenBuilt_ThenFailed", () => {
    expect(buildReport({ outcome: "success", messages: messages({ is_error: true }) }).status).toBe(
      "failed",
    );
  });

  it("GivenMissingExecutionFile_WhenBuilt_ThenFailedWithNulls", () => {
    const report = buildReport({
      outcome: "success",
      messages: readMessages("/nonexistent/execution.json"),
    });
    expect(report).toEqual({
      status: "failed",
      summary: "Agent step success; no result in the execution file",
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
    });
  });

  it("GivenGarbledExecutionFile_WhenRead_ThenNull", () => {
    const dir = mkdtempSync(join(tmpdir(), "executor-report-"));
    const path = join(dir, "execution.json");
    writeFileSync(path, "{not json");
    expect(readMessages(path)).toBeNull();
    writeFileSync(path, JSON.stringify({ type: "result" }));
    expect(readMessages(path)).toBeNull();
  });

  it("GivenReasonAndNoRun_WhenBuilt_ThenReasonIsSummary", () => {
    const report = buildReport({ outcome: "skipped", messages: null, reason: "setup failed" });
    expect(report).toMatchObject({ status: "failed", summary: "setup failed", tokensIn: null });
  });

  it("GivenLongResult_WhenBuilt_ThenSummaryTruncated", () => {
    const report = buildReport({
      outcome: "success",
      messages: messages({ result: "x".repeat(MAX_SUMMARY + 500) }),
    });
    expect(report.summary).toHaveLength(MAX_SUMMARY);
    expect(report.summary.endsWith("…")).toBe(true);
  });

  it("GivenShortText_WhenTruncated_ThenUnchanged", () => {
    expect(truncate("short")).toBe("short");
  });
});

describe("CLI", () => {
  it("GivenEnv_WhenRun_ThenPrintsOneLineJson", () => {
    const dir = mkdtempSync(join(tmpdir(), "executor-report-"));
    const path = join(dir, "execution.json");
    writeFileSync(path, JSON.stringify(messages({ result: "line one\nline two" })));
    const result = spawnSync(process.execPath, [join(import.meta.dirname, "executor-report.mjs")], {
      encoding: "utf8",
      env: { ...process.env, OUTCOME: "success", EXECUTION_FILE: path },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "succeeded", tokensOut: 200 });
  });
});
