import type { RunUsage } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { CACHE_WRITE_FALLBACK, reserveFor, settleFor } from "./spend-estimate";

/** AI-236: M10.4: Paid-call estimate. Integer micro-USD, rounded up; unknown means null. */

const priced = { priceInPerMTokUsd: 3, priceOutPerMTokUsd: 15 };
const unpricedIn = { priceInPerMTokUsd: null, priceOutPerMTokUsd: 15 };
const unpricedOut = { priceInPerMTokUsd: 3, priceOutPerMTokUsd: null };
const usage = (u: Partial<RunUsage> = {}): RunUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: null,
  wallMs: null,
  ...u,
});
const call = (inputTokens: number, maxOutputTokens: number) =>
  ({ kind: "call", inputTokens, maxOutputTokens }) as const;

describe("reserveFor", () => {
  it.each([
    ["no input price", unpricedIn],
    ["no output price", unpricedOut],
    ["a negative price", { priceInPerMTokUsd: -1, priceOutPerMTokUsd: 15 }],
    ["a NaN price", { priceInPerMTokUsd: Number.NaN, priceOutPerMTokUsd: 15 }],
    ["an infinite price", { priceInPerMTokUsd: 3, priceOutPerMTokUsd: Infinity }],
  ])("GivenAModelWith%s_WhenACallIsReserved_ThenThereIsNoEstimate", (_name, model) => {
    expect(reserveFor(model, call(1000, 1000))).toBeNull();
  });

  it("GivenAModelWithNoPrice_WhenATaskIsReserved_ThenThereIsNoEstimateEvenWithACap", () => {
    expect(reserveFor(unpricedIn, { kind: "task", taskCapMicroUsd: 2_000_000 })).toBeNull();
  });

  it("GivenACall_WhenReserved_ThenInputAtInputPricePlusMaxOutputAtOutputPrice", () => {
    // 10,000 × $3/M + 4,000 × $15/M = $0.03 + $0.06 = $0.09
    expect(reserveFor(priced, call(10_000, 4_000))).toBe(90_000);
  });

  it("GivenALargerMaxOutput_WhenReserved_ThenTheReserveGrowsWithIt", () => {
    // The reserve uses max output tokens, never a smaller expected count.
    expect(reserveFor(priced, call(0, 64_000))).toBe(960_000);
    expect(reserveFor(priced, call(0, 64_001))).toBeGreaterThan(960_000);
  });

  it("GivenAFractionOfAMicroUsd_WhenReserved_ThenItRoundsUp", () => {
    // 1 token × $3/M = 3 micro-USD; 1 token × $0.5/M = 0.5 micro-USD → 1.
    expect(reserveFor(priced, call(1, 0))).toBe(3);
    expect(reserveFor({ priceInPerMTokUsd: 0.5, priceOutPerMTokUsd: 1 }, call(1, 0))).toBe(1);
  });

  it("GivenAFreeModel_WhenReserved_ThenTheReserveIsZeroNotUnknown", () => {
    expect(reserveFor({ priceInPerMTokUsd: 0, priceOutPerMTokUsd: 0 }, call(5, 5))).toBe(0);
  });

  it("GivenAPriceWithFloatNoise_WhenReserved_ThenTheNoiseDoesNotRoundUp", () => {
    // 0.00391 × 1e6 is 3910.0000000000005 in floating point; 1M tokens cost exactly 3,910.
    expect(reserveFor({ priceInPerMTokUsd: 0.00391, priceOutPerMTokUsd: 0 }, call(1e6, 0))).toBe(
      3_910,
    );
  });

  it("GivenAPriceFinerThanAMicroUsd_WhenReserved_ThenThePriceRoundsUp", () => {
    // $0.0000005/M → 1 micro-USD per million tokens, never 0.
    expect(reserveFor({ priceInPerMTokUsd: 5e-7, priceOutPerMTokUsd: 0 }, call(1e6, 0))).toBe(1);
  });

  it.each([1e-13, 1e-20, 5e-324, 0.000001])(
    "GivenATinyNonZeroPriceOf%s_WhenOneTokenIsReserved_ThenTheReserveIsNeverZero",
    (price) => {
      expect(reserveFor({ priceInPerMTokUsd: price, priceOutPerMTokUsd: 0 }, call(1, 0))).toBe(1);
      expect(reserveFor({ priceInPerMTokUsd: 0, priceOutPerMTokUsd: price }, call(0, 1))).toBe(1);
    },
  );

  it("GivenAPriceWithManyDecimals_WhenReserved_ThenItIsExactToTwelveDecimals", () => {
    // $1.23456789012/M × 1M tokens = $1.23456789012 → 1,234,568 micro-USD (rounded up).
    const model = { priceInPerMTokUsd: 1.23456789012, priceOutPerMTokUsd: 0 };
    expect(reserveFor(model, call(1e6, 0))).toBe(1_234_568);
  });

  it("GivenAHugePrice_WhenReserved_ThenItIsExactWhileSafeAndNullPastThat", () => {
    // $1e15/M is $1e9 per token: 1e15 micro-USD, still a safe integer.
    expect(reserveFor({ priceInPerMTokUsd: 1e15, priceOutPerMTokUsd: 0 }, call(1, 0))).toBe(1e15);
    // $1e21/M (String gives "1e+21") is 1e21 micro-USD per token: past the safe range.
    expect(reserveFor({ priceInPerMTokUsd: 1e21, priceOutPerMTokUsd: 0 }, call(1, 0))).toBeNull();
    const max = { priceInPerMTokUsd: Number.MAX_VALUE, priceOutPerMTokUsd: 0 };
    expect(reserveFor(max, call(1, 0))).toBeNull();
  });

  it("GivenAnAgenticTask_WhenReserved_ThenTheReserveIsItsPerTaskCap", () => {
    expect(reserveFor(priced, { kind: "task", taskCapMicroUsd: 2_000_000 })).toBe(2_000_000);
  });

  it.each([
    ["negative input tokens", call(-1, 0)],
    ["fractional output tokens", call(0, 1.5)],
    ["a negative task cap", { kind: "task", taskCapMicroUsd: -1 } as const],
  ])("GivenACallWith%s_WhenReserved_ThenItThrows", (_name, limits) => {
    expect(() => reserveFor(priced, limits)).toThrow(RangeError);
  });

  it("GivenATotalPastTheSafeIntegerRange_WhenReserved_ThenThereIsNoEstimate", () => {
    const huge = { priceInPerMTokUsd: 1e9, priceOutPerMTokUsd: 0 };
    expect(reserveFor(huge, call(Number.MAX_SAFE_INTEGER, 0))).toBeNull();
  });
});

describe("settleFor", () => {
  it("GivenNoUsage_WhenSettled_ThenThereIsNoCostSoTheReservationIsKept", () => {
    expect(settleFor(priced, null)).toBeNull();
  });

  it.each([
    ["negative input tokens", { inputTokens: -1 }],
    ["fractional output tokens", { outputTokens: 1.5 }],
    ["NaN cache reads", { cacheReadTokens: Number.NaN }],
    ["unsafe cache writes", { cacheWriteTokens: 2 ** 53 }],
  ])("GivenUsageWith%s_WhenSettled_ThenThereIsNoCostSoTheReservationIsKept", (_name, bad) => {
    expect(settleFor(priced, usage(bad))).toBeNull();
  });

  it("GivenATinyCacheWritePrice_WhenSettled_ThenOneTokenStillCosts", () => {
    const model = { priceInPerMTokUsd: 0, priceOutPerMTokUsd: 0, priceCacheWritePerMTokUsd: 1e-13 };
    expect(settleFor(model, usage({ cacheWriteTokens: 1 }))).toBe(1);
  });

  it("GivenAModelWithNoPrice_WhenSettled_ThenThereIsNoCost", () => {
    expect(settleFor(unpricedOut, usage({ inputTokens: 10 }))).toBeNull();
  });

  it("GivenUsage_WhenSettled_ThenInputAndOutputUseTheModelPrices", () => {
    // 2,000 × $3/M + 500 × $15/M = 6,000 + 7,500 micro-USD
    expect(settleFor(priced, usage({ inputTokens: 2_000, outputTokens: 500 }))).toBe(13_500);
  });

  it("GivenCacheReadsAndCachePrices_WhenSettled_ThenCacheTokensUseThem", () => {
    const model = { ...priced, priceCacheReadPerMTokUsd: 0.3, priceCacheWritePerMTokUsd: 3.75 };
    // 1M × $0.3/M + 1M × $3.75/M = 300,000 + 3,750,000
    const u = usage({ cacheReadTokens: 1e6, cacheWriteTokens: 1e6 });
    expect(settleFor(model, u)).toBe(4_050_000);
  });

  it("GivenCacheTokensAndNoCachePrices_WhenSettled_ThenReadsAtInputAndWritesAtTheFallback", () => {
    // Never below the real cost: reads at the input price, writes at 2 × input.
    const u = usage({ cacheReadTokens: 1e6, cacheWriteTokens: 1e6 });
    expect(settleFor(priced, u)).toBe(3_000_000 + 3_000_000 * CACHE_WRITE_FALLBACK);
  });

  it("GivenABadExplicitCachePrice_WhenSettled_ThenThereIsNoCost", () => {
    const model = { ...priced, priceCacheReadPerMTokUsd: -0.3 };
    expect(settleFor(model, usage({ cacheReadTokens: 1 }))).toBeNull();
  });

  it("GivenManyLinesWithFractions_WhenSettled_ThenTheyAreSummedThenRoundedUpOnce", () => {
    // 1 input (3) + 1 output (15) + 1 cache read at $0.3/M (0.3) = 18.3 → 19, not 3 + 15 + 1.
    const model = { ...priced, priceCacheReadPerMTokUsd: 0.3 };
    const u = usage({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 1 });
    expect(settleFor(model, u)).toBe(19);
  });

  it("GivenTheSameTokens_WhenReservedAndSettled_ThenTheReserveCoversTheSettledCost", () => {
    const reserve = reserveFor(priced, call(7_777, 3_333));
    const settled = settleFor(priced, usage({ inputTokens: 7_777, outputTokens: 3_333 }));
    expect(reserve).toBe(settled);
  });
});
