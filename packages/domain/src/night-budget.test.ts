import { describe, expect, it } from "vitest";
import { nightEndReason, nightLimitReached, nightUsage, winsNightSlot } from "./night-budget";

/** M4.18: Night budget (ADR-0049): what a launch used, which limit it reached, why it ends. */

const START = "2026-11-12T22:00:00.000Z";
const budget = { maxRuns: 3, maxTokens: 10_000, maxUsd: 5 };
const launch = { startedAt: START, budget, stopAt: "2026-11-13T06:00:00.000Z" };
type Status = "queued" | "running" | "succeeded" | "failed";
const EXECUTOR = { repo: "o/r", ref: "w", externalId: "1" };
const run = (
  createdAt: string | null,
  tokensIn: number | null,
  costUsd: number | null,
  status: Status = "succeeded",
  dispatched = true,
) => ({
  createdAt,
  tokensIn,
  tokensOut: tokensIn === null ? null : 100,
  costUsd,
  status,
  executor: dispatched ? EXECUTOR : null,
  localRun: null,
});
const at = (iso: string) => new Date(iso);
const NIGHT = at("2026-11-13T01:00:00.000Z");

describe("night budget", () => {
  it("GivenRunsBeforeAndDuringTheLaunch_WhenUsageIsCounted_ThenOnlyTheLaunchsRunsCount", () => {
    const usage = nightUsage(launch, [
      run("2026-11-12T21:00:00.000Z", 5000, 2), // before the launch
      run("2026-11-12T23:00:00.000Z", 1000, 1.5),
      run("2026-11-13T00:00:00.000Z", null, null, "running"), // no usage yet
    ]);
    expect(usage).toEqual({ runs: 2, tokens: 1100, usd: 1.5 });
  });

  it("GivenAStartThatLostARaceAndWasFailedBeforeDispatch_WhenUsageIsCounted_ThenItDoesNotCount", () => {
    const lost = run("2026-11-12T23:00:00.000Z", null, null, "failed", false);
    const queued = run("2026-11-12T23:00:00.000Z", null, null, "queued", false);
    expect(nightUsage(launch, [lost, queued]).runs).toBe(1);
  });

  it("GivenThreeConcurrentStartsAndMaxTwo_WhenEachChecksItsSlot_ThenOnlyTheTwoOldestWin", () => {
    const slot = {
      launch: { id: "l", ...launch, budget: { ...budget, maxRuns: 2 } },
      ticketIds: [],
    };
    const queued = (id: string, createdAt: string) => ({
      ...run(createdAt, null, null, "queued", false),
      id,
    });
    const runs = [
      queued("c", "2026-11-12T23:00:02.000Z"),
      queued("a", "2026-11-12T23:00:00.000Z"),
      queued("b", "2026-11-12T23:00:01.000Z"),
    ];
    expect(["a", "b", "c"].map((id) => winsNightSlot(slot, runs, id))).toEqual([true, true, false]);
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
