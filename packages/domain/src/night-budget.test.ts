import { describe, expect, it } from "vitest";
import { nightEndReason, nightLimitReached, nightUsage } from "./night-budget";

/** M4.18: Night budget (ADR-0049): what a launch used, which limit it reached, why it ends. */

const START = "2026-11-12T22:00:00.000Z";
const budget = { maxRuns: 3, maxTokens: 10_000, maxUsd: 5 };
const launch = { startedAt: START, budget, stopAt: "2026-11-13T06:00:00.000Z" };
const run = (createdAt: string | null, tokensIn: number | null, costUsd: number | null) => ({
  createdAt,
  tokensIn,
  tokensOut: tokensIn === null ? null : 100,
  costUsd,
});
const at = (iso: string) => new Date(iso);
const NIGHT = at("2026-11-13T01:00:00.000Z");

describe("night budget", () => {
  it("GivenRunsBeforeAndDuringTheLaunch_WhenUsageIsCounted_ThenOnlyTheLaunchsRunsCount", () => {
    const usage = nightUsage(launch, [
      run("2026-11-12T21:00:00.000Z", 5000, 2), // before the launch
      run("2026-11-12T23:00:00.000Z", 1000, 1.5),
      run("2026-11-13T00:00:00.000Z", null, null), // still running: no usage yet
    ]);
    expect(usage).toEqual({ runs: 2, tokens: 1100, usd: 1.5 });
  });

  it("GivenARunWithNoCreationTime_WhenUsageIsCounted_ThenItCounts", () => {
    expect(nightUsage(launch, [run(null, 0, 0)]).runs).toBe(1);
  });

  it("GivenUsageUnderEveryLimit_WhenChecked_ThenNoLimitIsReached", () => {
    expect(nightLimitReached(launch, { runs: 2, tokens: 9999, usd: 4.99 }, NIGHT)).toBeNull();
  });

  it.each([
    ["max_runs", { runs: 3, tokens: 0, usd: 0 }],
    ["max_tokens", { runs: 0, tokens: 10_000, usd: 0 }],
    ["max_usd", { runs: 0, tokens: 0, usd: 5 }],
  ] as const)("GivenUsageAtTheBudget_WhenChecked_Then%sIsReached", (limit, usage) => {
    expect(nightLimitReached(launch, usage, NIGHT)).toBe(limit);
  });

  it("GivenTheStopTime_WhenChecked_ThenStopTimeIsReachedFirst", () => {
    const usage = { runs: 3, tokens: 10_000, usd: 5 };
    expect(nightLimitReached(launch, usage, at(launch.stopAt))).toBe("stop_time");
  });

  it.each([
    ["a limit", { status: "running" }, "max_usd", false, "max_usd"],
    ["Andy's stop", { status: "stopping" }, null, false, "stopped"],
    ["every story finished", { status: "running" }, null, true, "done"],
    ["nothing to end for", { status: "running" }, null, false, null],
  ] as const)(
    "GivenNothingInFlightAnd%s_WhenTheEndIsChecked_ThenTheReasonMatches",
    (_, l, limit, finished, reason) => {
      expect(nightEndReason(l, limit, finished)).toBe(reason);
    },
  );
});
