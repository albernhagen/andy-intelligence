import {
  DEFAULT_SPEND_CAPS,
  type EffectiveSpendCaps,
  type SpendCaps,
  type SpendSoFar,
} from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { effectiveCaps, maySpend } from "./spend-caps";

/** AI-235: M10.3: Spend caps rule. Amounts in micro-dollars (1 USD = 1,000,000). */

const USD = 1_000_000;
const GLOBAL: SpendCaps = {
  dailyMicroUsd: 5 * USD,
  monthlyMicroUsd: 50 * USD,
  perTaskMicroUsd: 2 * USD,
};
const CAPS: EffectiveSpendCaps = {
  per_task: 2 * USD,
  project_daily: 3 * USD,
  project_monthly: 20 * USD,
  global_daily: 5 * USD,
  global_monthly: 50 * USD,
};
const spent = (projectDay = 0, projectMonth = 0, globalDay = 0, globalMonth = 0): SpendSoFar => ({
  project: { dayMicroUsd: projectDay, monthMicroUsd: projectMonth },
  global: { dayMicroUsd: globalDay, monthMicroUsd: globalMonth },
});

describe("DEFAULT_SPEND_CAPS", () => {
  it("GivenNoAnswerFromAndyYet_WhenRead_ThenFiveADayFiftyAMonthTwoPerTask", () => {
    expect(DEFAULT_SPEND_CAPS).toEqual(GLOBAL);
  });
});

describe("effectiveCaps", () => {
  it("GivenNoProjectCaps_WhenCombined_ThenTheGlobalCapsApply", () => {
    expect(effectiveCaps(GLOBAL, null)).toEqual({
      per_task: 2 * USD,
      project_daily: 5 * USD,
      project_monthly: 50 * USD,
      global_daily: 5 * USD,
      global_monthly: 50 * USD,
    });
  });

  it("GivenLowerProjectCaps_WhenCombined_ThenTheyNarrowTheGlobalOnes", () => {
    const caps = effectiveCaps(GLOBAL, {
      dailyMicroUsd: 1 * USD,
      monthlyMicroUsd: 10 * USD,
      perTaskMicroUsd: 500_000,
    });
    expect(caps).toMatchObject({
      per_task: 500_000,
      project_daily: 1 * USD,
      project_monthly: 10 * USD,
    });
    expect(caps.global_daily).toBe(5 * USD);
  });

  it("GivenAProjectCapAboveTheGlobalOne_WhenCombined_ThenTheGlobalCapIsUsed", () => {
    const caps = effectiveCaps(GLOBAL, { dailyMicroUsd: 99 * USD, perTaskMicroUsd: null });
    expect(caps.project_daily).toBe(5 * USD);
    expect(caps.per_task).toBe(2 * USD);
    expect(caps.project_monthly).toBe(50 * USD);
  });

  it("GivenACapThatIsNotAWholeNumber_WhenCombined_ThenRejected", () => {
    expect(() => effectiveCaps({ ...GLOBAL, dailyMicroUsd: 1.5 }, null)).toThrow();
    expect(() => effectiveCaps(GLOBAL, { dailyMicroUsd: -1 })).toThrow();
  });
});

describe("maySpend", () => {
  it("GivenRoomUnderEveryCap_WhenAsked_ThenAllow", () => {
    expect(maySpend(CAPS, spent(1 * USD, 5 * USD, 2 * USD, 10 * USD), 1 * USD)).toEqual({
      kind: "allow",
    });
  });

  it("GivenAnEstimateExactlyAtACap_WhenAsked_ThenAllow", () => {
    expect(maySpend(CAPS, spent(1 * USD), 2 * USD)).toEqual({ kind: "allow" });
  });

  it.each([
    ["per_task", spent(), 2 * USD + 1, 2 * USD, 0],
    ["project_daily", spent(2 * USD), 1 * USD + 1, 3 * USD, 2 * USD],
    ["project_monthly", spent(0, 19 * USD), 1 * USD + 1, 20 * USD, 19 * USD],
    ["global_daily", spent(0, 0, 4 * USD), 1 * USD + 1, 5 * USD, 4 * USD],
    ["global_monthly", spent(0, 0, 0, 49 * USD), 1 * USD + 1, 50 * USD, 49 * USD],
  ] as const)(
    "GivenAnEstimateThatWouldPass %s_WhenAsked_ThenThatCap",
    (cap, totals, estimate, limitMicroUsd, usedMicroUsd) => {
      expect(maySpend(CAPS, totals, estimate)).toEqual({
        kind: "cap",
        cap,
        limitMicroUsd,
        usedMicroUsd,
      });
    },
  );

  it("GivenAnEstimateThatPassesSeveralCaps_WhenAsked_ThenPerTaskComesFirst", () => {
    expect(maySpend(CAPS, spent(3 * USD, 20 * USD, 5 * USD, 50 * USD), 3 * USD)).toMatchObject({
      kind: "cap",
      cap: "per_task",
    });
    expect(maySpend(CAPS, spent(3 * USD, 20 * USD, 5 * USD, 50 * USD), 1)).toMatchObject({
      cap: "project_daily",
    });
  });

  it.each([
    ["unknown totals", CAPS, "unknown", 1, "totals"],
    ["missing totals", CAPS, undefined, 1, "totals"],
    ["fractional totals", CAPS, spent(0.5), 1, "totals"],
    ["no price", CAPS, spent(), null, "estimate"],
    ["a fractional estimate", CAPS, spent(), 0.5, "estimate"],
    ["a negative estimate", CAPS, spent(), -1, "estimate"],
    ["a missing cap", { ...CAPS, global_monthly: undefined }, spent(), 1, "caps"],
    ["no caps at all", null, spent(), 1, "caps"],
    ["a cap that doesn't parse", { ...CAPS, per_task: "2" }, spent(), 1, "caps"],
  ] as const)("GivenFailClosedInput %s_WhenAsked_ThenUnknownNeverAllow", (_l, c, t, e, reason) => {
    expect(maySpend(c, t, e)).toEqual({ kind: "unknown", reason });
  });
});
