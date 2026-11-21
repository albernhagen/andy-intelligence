import { describe, expect, it } from "vitest";
import { doraMetrics, type DoraDeployment } from "./dora";

const WEEK = { from: "2026-11-01T00:00:00.000Z", to: "2026-11-08T00:00:00.000Z" };
const at = (day: number, hour = 0) => new Date(Date.UTC(2026, 10, day, hour)).toISOString();

const deploy = (over: Partial<DoraDeployment> & { deployedAt: string }): DoraDeployment => ({
  changeCommittedAt: [],
  failed: false,
  restoredAt: null,
  ...over,
});

describe("doraMetrics (AI-170)", () => {
  it("GivenNoDeployments_WhenMeasured_ThenFrequencyIsZeroAndTheRestIsEmpty", () => {
    expect(doraMetrics([], WEEK)).toEqual({
      deployments: 0,
      deployFrequency: { perDay: 0, perWeek: 0 },
      leadTimeHours: { median: null, p90: null, count: 0 },
      changeFailureRate: null,
      failedDeployments: 0,
      timeToRestoreHours: { median: null, p90: null, count: 0, open: 0 },
      ignored: 0,
    });
  });

  it("GivenDeploymentsInAndAroundTheWindow_WhenMeasured_ThenOnlyThoseFromIncludedToExcludedCount", () => {
    const m = doraMetrics(
      [
        deploy({ deployedAt: WEEK.from }),
        deploy({ deployedAt: at(3, 12) }),
        deploy({ deployedAt: at(7, 23) }),
        deploy({ deployedAt: WEEK.to }),
        deploy({ deployedAt: "2026-10-31T23:59:59.000Z" }),
      ],
      WEEK,
    );
    expect(m.deployments).toBe(3);
    expect(m.deployFrequency).toEqual({ perDay: 0.43, perWeek: 3 });
  });

  it("GivenChangesShippedByDeployments_WhenMeasured_ThenLeadTimeIsCommitToProductionPerChange", () => {
    const m = doraMetrics(
      [
        deploy({ deployedAt: at(2, 12), changeCommittedAt: [at(2, 10), at(1, 12)] }),
        deploy({ deployedAt: at(4), changeCommittedAt: [at(3, 23)] }),
        deploy({ deployedAt: at(6), changeCommittedAt: [at(1)] }),
      ],
      WEEK,
    );
    // Samples, in hours: 2, 24, 1, 120. Nearest rank: median = 2nd, p90 = 4th.
    expect(m.leadTimeHours).toEqual({ median: 2, p90: 120, count: 4 });
  });

  it("GivenFailedDeployments_WhenMeasured_ThenFailureRateAndRestoreTimesCountOpenFailuresApart", () => {
    const m = doraMetrics(
      [
        deploy({ deployedAt: at(2), failed: true, restoredAt: at(2, 1) }),
        deploy({ deployedAt: at(3), failed: true, restoredAt: at(3, 6) }),
        deploy({ deployedAt: at(4), failed: true, restoredAt: null }),
        deploy({ deployedAt: at(5) }),
      ],
      WEEK,
    );
    expect(m.changeFailureRate).toBe(0.75);
    expect(m.failedDeployments).toBe(3);
    expect(m.timeToRestoreHours).toEqual({ median: 1, p90: 6, count: 2, open: 1 });
  });

  it("GivenARestoreWithoutAFailure_WhenMeasured_ThenItIsNotTimed", () => {
    const m = doraMetrics([deploy({ deployedAt: at(2), restoredAt: at(2, 3) })], WEEK);
    expect(m.timeToRestoreHours).toEqual({ median: null, p90: null, count: 0, open: 0 });
    expect(m.changeFailureRate).toBe(0);
  });

  it("GivenBadInputs_WhenMeasured_ThenTheyAreLeftOutAndCounted", () => {
    const m = doraMetrics(
      [
        deploy({ deployedAt: "not a date" }),
        // A change committed after its deployment, and one that doesn't parse.
        deploy({ deployedAt: at(2), changeCommittedAt: [at(3), "nope", at(1)] }),
        // A restore before its failure.
        deploy({ deployedAt: at(4), failed: true, restoredAt: at(3) }),
      ],
      WEEK,
    );
    expect(m.ignored).toBe(4);
    expect(m.deployments).toBe(2);
    expect(m.leadTimeHours).toEqual({ median: 24, p90: 24, count: 1 });
    expect(m.timeToRestoreHours).toMatchObject({ count: 0, open: 0 });
    expect(m.failedDeployments).toBe(1);
  });

  it("GivenAWindowThatIsEmptyOrBackwards_WhenMeasured_ThenRangeError", () => {
    expect(() => doraMetrics([], { from: WEEK.to, to: WEEK.from })).toThrow(RangeError);
    expect(() => doraMetrics([], { from: WEEK.from, to: WEEK.from })).toThrow(RangeError);
    expect(() => doraMetrics([], { from: "x", to: WEEK.to })).toThrow(RangeError);
  });

  it("GivenTheSameInput_WhenMeasuredTwice_ThenTheResultIsTheSameAndTheInputUnchanged", () => {
    const input = [deploy({ deployedAt: at(2), changeCommittedAt: [at(1)] })];
    const copy = structuredClone(input);
    expect(doraMetrics(input, WEEK)).toEqual(doraMetrics(input, WEEK));
    expect(input).toEqual(copy);
  });
});
