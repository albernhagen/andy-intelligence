import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "./rate-limit";

describe("FixedWindowLimiter", () => {
  it("GivenTheLimitIsReached_WhenTakingWithinTheWindow_ThenRefusedUntilTheNextWindow", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter(2, 1000, () => now);
    expect([limiter.tryTake(), limiter.tryTake(), limiter.tryTake()]).toEqual([true, true, false]);
    now = 999;
    expect(limiter.tryTake()).toBe(false);
    now = 1000;
    expect(limiter.tryTake()).toBe(true);
  });

  it("GivenRepeatedRefusals_WhenAskingForTheFirst_ThenOnlyTheFirstInEachWindowCounts", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter(1, 1000, () => now);
    limiter.tryTake();
    const firsts = [1, 2, 3].map(() => !limiter.tryTake() && limiter.firstRefusalInWindow());
    expect(firsts).toEqual([true, false, false]);
    now = 1000;
    limiter.tryTake();
    expect(!limiter.tryTake() && limiter.firstRefusalInWindow()).toBe(true);
  });
});
