import { describe, expect, it } from "vitest";
import { TIER_FOR_SIZE, TIER_ROUTES, tierFor } from "./tiers";

describe("tierFor", () => {
  it.each([
    ["S", "fast"],
    ["M", "strong"],
    ["L", "strong"],
  ] as const)("GivenSize%s_WhenNoOverride_ThenTier%s", (size, tier) => {
    expect(tierFor({ size, overrides: {} })).toBe(tier);
  });

  it("GivenAnOverride_WhenDerived_ThenTheOverrideWins", () => {
    expect(tierFor({ size: "S", overrides: { tier: "frontier" } })).toBe("frontier");
    expect(tierFor({ size: null, overrides: { tier: "cheap" } })).toBe("cheap");
  });

  it("GivenNoSizeAndNoOverride_WhenDerived_ThenNull", () => {
    expect(tierFor({ size: null, overrides: {} })).toBeNull();
  });

  it("GivenTheSizeTiers_WhenRouted_ThenSonnetForSAndOpusForMAndL", () => {
    expect(TIER_ROUTES[TIER_FOR_SIZE.S].model).toBe("sonnet");
    expect(TIER_ROUTES[TIER_FOR_SIZE.M].model).toBe("opus");
    expect(TIER_ROUTES[TIER_FOR_SIZE.L].model).toBe("opus");
  });
});
