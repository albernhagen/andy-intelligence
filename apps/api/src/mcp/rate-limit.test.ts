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
});
