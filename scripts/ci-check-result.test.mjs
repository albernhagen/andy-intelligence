import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judgeResults } from "./ci-check-result.mjs";

const needs = (results) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]),
    ),
  );
const all = (result) => ({
  "check-lint": "success",
  "check-typecheck": "success",
  "check-test": result,
  "check-build": "success",
});

describe("judgeResults", () => {
  it("GivenEveryPartSucceeded_WhenJudged_ThenOk", () => {
    const { ok, lines } = judgeResults(needs(all("success")));
    expect(ok).toBe(true);
    expect(lines).toContain("check-test: success");
  });

  it.each(["failure", "skipped", "cancelled"])("GivenOnePart%s_WhenJudged_ThenNotOk", (result) => {
    const { ok, lines } = judgeResults(needs(all(result)));
    expect(ok).toBe(false);
    expect(lines).toContain(`check-test: ${result}`);
  });

  it.each(["", "not json", "null", "[]", "{}"])(
    "GivenUnusableResults%j_WhenJudged_ThenNotOk",
    (text) => {
      expect(judgeResults(text).ok).toBe(false);
    },
  );

  it("GivenAJobWithoutAResult_WhenJudged_ThenNotOk", () => {
    expect(judgeResults(JSON.stringify({ "check-lint": {} })).ok).toBe(false);
  });
});

describe("CLI", () => {
  const script = join(import.meta.dirname, "ci-check-result.mjs");
  const run = (results) =>
    execFileSync("node", [script], { env: { ...process.env, RESULTS: results }, encoding: "utf8" });

  it("GivenAllSuccess_WhenRun_ThenExitsZero", () => {
    expect(run(needs(all("success")))).toContain("every part passed");
  });

  it("GivenACancelledPart_WhenRun_ThenExitsOne", () => {
    expect(() => run(needs(all("cancelled")))).toThrow();
  });
});
