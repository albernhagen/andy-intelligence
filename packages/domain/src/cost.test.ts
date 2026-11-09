import { InMemoryRunStore, type QuotaReading, type Run } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { estimateCostUsd, quotaDelta, runCost, ticketCost } from "./cost";

const usage = {
  inputTokens: 1_000_000,
  outputTokens: 100_000,
  cacheReadTokens: 1_000_000,
  cacheWriteTokens: 100_000,
  turns: 4,
  wallMs: 60_000,
};
const reading = (window: "5h" | "weekly", usedPct: number, over = {}): QuotaReading => ({
  provider: "claude-sub",
  window,
  usedPct,
  resetsAt: "2026-11-09T20:00:00.000Z",
  source: "test",
  takenAt: "2026-11-09T12:00:00.000Z",
  confidence: "high",
  ...over,
});

describe("estimateCostUsd", () => {
  it("GivenAKnownModel_WhenEstimated_ThenEveryTokenKindIsPriced", () => {
    expect(estimateCostUsd("sonnet", usage)).toBe(3.45);
    expect(estimateCostUsd("claude-opus-5-5", usage)).toBe(6.7);
  });

  it("GivenAnUnknownOrInheritedName_WhenEstimated_ThenNull", () => {
    expect(estimateCostUsd("gpt-x", usage)).toBeNull();
    expect(estimateCostUsd("constructor", usage)).toBeNull();
  });
});

describe("runCost", () => {
  it("GivenASubscriptionRunWithUsage_WhenCosted_ThenTheRateTableEstimate", () => {
    expect(runCost("sonnet", "subscription", usage, 9)).toEqual({
      costUsd: 3.45,
      costIsEstimate: true,
    });
  });

  it("GivenASubscriptionRunWithoutUsage_WhenCosted_ThenUnknownEvenWithAFigure", () => {
    expect(runCost("sonnet", "subscription", null, 9).costUsd).toBeNull();
  });

  it("GivenAModelNotInTheTable_WhenCosted_ThenTheReportedFigureAsAnEstimate", () => {
    expect(runCost("new-model", "subscription", usage, 0.5)).toEqual({
      costUsd: 0.5,
      costIsEstimate: true,
    });
  });

  it("GivenPayPerUseWithAReportedAmount_WhenCosted_ThenItIsActual", () => {
    expect(runCost("x", "pay_per_use", null, 2)).toEqual({ costUsd: 2, costIsEstimate: false });
  });
});

describe("quotaDelta", () => {
  it("GivenReadingsInTheSameWindows_WhenCompared_ThenTheDifference", () => {
    expect(
      quotaDelta(
        [reading("5h", 10), reading("weekly", 20)],
        [reading("5h", 13.5), reading("weekly", 20.2)],
      ),
    ).toEqual({ "5h": 3.5, weekly: 0.2 });
  });

  it("GivenAWindowThatResetBetweenReadings_WhenCompared_ThenThatWindowIsUnknown", () => {
    const after = { takenAt: "2026-11-09T21:00:00.000Z" };
    expect(
      quotaDelta(
        [reading("5h", 90), reading("weekly", 20, { resetsAt: "2026-11-12T00:00:00.000Z" })],
        [reading("5h", 5, after), reading("weekly", 22, after)],
      ),
    ).toEqual({ "5h": null, weekly: 2 });
  });

  it("GivenUsageThatDropped_WhenCompared_ThenUnknown", () => {
    expect(quotaDelta([reading("5h", 50)], [reading("5h", 40)])).toBeNull();
  });

  it("GivenNoEarlierReading_WhenCompared_ThenNull", () => {
    expect(quotaDelta([], [reading("5h", 40)])).toBeNull();
  });
});

describe("ticketCost", () => {
  const make = async (patches: Partial<Run>[]) => {
    const store = new InMemoryRunStore();
    return Promise.all(
      patches.map(async (patch) => {
        const run = await store.create({
          projectId: "ai",
          ticketId: "t1",
          step: "refine",
          route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
          tier: null,
          deadline: null,
          prompt: "p",
          maxTurns: 1,
        });
        return store.update(run.id, patch, ["queued"]);
      }),
    );
  };

  it("GivenFinishedAndActiveRuns_WhenTotalled_ThenUnknownIsCountedNotPricedAsZero", async () => {
    const runs = await make([
      { status: "succeeded", costUsd: 1.5, quotaDelta: { "5h": 2, weekly: null } },
      { status: "failed", costUsd: 0.25, quotaDelta: { "5h": 1.5, weekly: null } },
      { status: "failed", costUsd: null },
      { status: "running", costUsd: null },
    ]);
    expect(ticketCost(runs)).toEqual({
      estimatedCostUsd: 1.75,
      quotaDelta: { "5h": 3.5, weekly: null },
      completedRuns: 3,
      unknownRuns: 1,
    });
  });

  it("GivenNoRuns_WhenTotalled_ThenZeros", () => {
    expect(ticketCost([])).toEqual({
      estimatedCostUsd: 0,
      quotaDelta: { "5h": null, weekly: null },
      completedRuns: 0,
      unknownRuns: 0,
    });
  });
});
