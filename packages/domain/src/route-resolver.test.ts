import {
  DEFAULT_ROUTING,
  type Route,
  type RoutingConfig,
  type Size,
  type TierKey,
} from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { buildRoute } from "./builds";
import { effectiveRouting, resolveRoute, skippedText } from "./route-resolver";

/** AI-238: M9.6: narrowing and first usable route. */

const claude = (model: string): Route => ({
  harness: "claude-code",
  provider: "claude-sub",
  model,
});
const jules = (model = "gemini-pro"): Route => ({
  harness: "jules",
  provider: "google-sub",
  model,
});
const config = (change: (c: RoutingConfig) => void = () => {}): RoutingConfig => {
  const c = structuredClone(DEFAULT_ROUTING);
  change(c);
  return c;
};
const project = (change: (c: RoutingConfig) => void = () => {}): RoutingConfig =>
  config((c) => {
    c.scope = "project";
    c.projectId = "ai";
    change(c);
  });
const defaults = effectiveRouting(DEFAULT_ROUTING, null);

describe("default routing picks today's routes", () => {
  it.each<[Size, string]>([
    ["S", "sonnet"],
    ["M", "opus"],
    ["L", "opus"],
  ])("GivenSize%s_WhenEachTicketStepResolves_ThenModel%s", (size, model) => {
    for (const step of ["plan", "build", "sync"] as const) {
      const resolved = buildRoute({ size, overrides: {} }, defaults, step);
      expect(resolved.route).toEqual(claude(model));
      expect(resolved.skipped).toEqual([]);
    }
  });

  it.each<[TierKey, string]>([
    ["frontier", "opus"],
    ["strong", "opus"],
    ["fast", "sonnet"],
    ["cheap", "sonnet"],
  ])("GivenTierPin%s_WhenABuildResolves_ThenModel%s", (tier, model) => {
    expect(buildRoute({ size: "M", overrides: { tier } }, defaults).route).toEqual(claude(model));
  });

  it("GivenAnyTicket_WhenRefineResolves_ThenSonnetLikeToday", () => {
    for (const size of ["S", "M", "L"] as const) {
      expect(
        buildRoute({ size, overrides: { tier: "frontier" } }, defaults, "refine").route,
      ).toEqual(claude("sonnet"));
    }
  });

  it("GivenNoSize_WhenABuildResolves_ThenTheFastTier", () => {
    expect(buildRoute({ size: null, overrides: {} })).toMatchObject({
      tier: "fast",
      route: claude("sonnet"),
    });
  });
});

describe("effectiveRouting: a project only narrows", () => {
  it("GivenAProjectThatEnablesAProviderGlobalDisables_WhenNarrowed_ThenItStaysOff", () => {
    const routing = effectiveRouting(
      DEFAULT_ROUTING,
      project((c) => (c.providers["google-sub"].enabled = true)),
    );
    expect(routing.providers["google-sub"].enabled).toBe(false);
  });

  it("GivenAProjectThatDisablesAProvider_WhenNarrowed_ThenItIsOff", () => {
    const routing = effectiveRouting(
      DEFAULT_ROUTING,
      project((c) => (c.providers["claude-sub"].enabled = false)),
    );
    expect(routing.providers["claude-sub"].enabled).toBe(false);
  });

  it("GivenDifferentLevels_WhenNarrowed_ThenHigherReserveAndLowerWarnPauseAndLimitWin", () => {
    const global = config((c) => {
      c.providers["google-sub"] = {
        enabled: true,
        reservePct: 20,
        warnPct: 70,
        pausePct: 80,
        dailyTaskLimit: 15,
      };
    });
    const routing = effectiveRouting(
      global,
      project((c) => {
        c.providers["google-sub"] = {
          enabled: true,
          reservePct: 10,
          warnPct: 75,
          pausePct: 60,
          dailyTaskLimit: 20,
        };
        c.providers["claude-sub"] = { ...c.providers["claude-sub"], reservePct: 40, warnPct: 50 };
      }),
    );
    expect(routing.providers["google-sub"]).toEqual({
      enabled: true,
      reservePct: 20,
      warnPct: 70,
      pausePct: 60,
      dailyTaskLimit: 15,
    });
    expect(routing.providers["claude-sub"]).toMatchObject({
      reservePct: 40,
      warnPct: 50,
      pausePct: 80,
    });
  });

  it("GivenAProjectTierWithARouteGlobalLacks_WhenNarrowed_ThenThatRouteIsDroppedAndOrderKept", () => {
    const global = config((c) => (c.tiers.strong = [claude("opus"), claude("sonnet")]));
    const routing = effectiveRouting(
      global,
      project((c) => (c.tiers.strong = [claude("haiku"), claude("sonnet"), claude("opus")])),
    );
    expect(routing.tiers.strong).toEqual([claude("sonnet"), claude("opus")]);
  });

  it("GivenAProjectThatPicksAnotherTierForAStep_WhenNarrowed_ThenTheProjectStepWins", () => {
    const routing = effectiveRouting(
      DEFAULT_ROUTING,
      project((c) => (c.steps.refine = "strong")),
    );
    expect(resolveRoute("refine", "fast", routing).route).toEqual(claude("opus"));
  });
});

describe("resolveRoute: the first usable route", () => {
  it("GivenTheFirstRouteOnADisabledProvider_WhenResolved_ThenTheNextAndWhyTheFirstWasSkipped", () => {
    const routing = effectiveRouting(
      config((c) => (c.tiers.strong = [jules(), claude("opus")])),
      null,
    );
    const resolved = resolveRoute("build", "strong", routing);
    expect(resolved.route).toEqual(claude("opus"));
    expect(resolved.skipped).toEqual([{ route: jules(), reason: "provider google-sub is off" }]);
  });

  it("GivenTheFirstRouteIncompatible_WhenResolved_ThenTheNextWithTheCompatibilityReason", () => {
    const bad: Route = { harness: "claude-code", provider: "openrouter", model: "opus" };
    const routing = effectiveRouting(
      config((c) => {
        c.providers.openrouter.enabled = true;
        c.tiers.fast = [bad, claude("sonnet")];
      }),
      null,
    );
    const resolved = resolveRoute("build", "fast", routing);
    expect(resolved.route).toEqual(claude("sonnet"));
    expect(resolved.skipped[0]?.reason).toContain("doesn't run on provider openrouter");
  });

  it("GivenNoUsableRoute_WhenResolved_ThenNoRouteAndEverySkipListed", () => {
    const routing = effectiveRouting(
      DEFAULT_ROUTING,
      project((c) => (c.providers["claude-sub"].enabled = false)),
    );
    const resolved = resolveRoute("build", "strong", routing);
    expect(resolved).toMatchObject({ route: null, tier: "strong" });
    expect(skippedText(resolved.skipped)).toBe(
      "claude-code/claude-sub/opus skipped: provider claude-sub is off",
    );
  });

  it("GivenAProjectTierLeftEmpty_WhenResolved_ThenNoRoute", () => {
    const routing = effectiveRouting(
      DEFAULT_ROUTING,
      project((c) => (c.tiers.fast = [claude("haiku")])),
    );
    expect(resolveRoute("build", "fast", routing).route).toBeNull();
  });
});

describe("resolveRoute: the ticket's model pin", () => {
  it("GivenACompatiblePin_WhenABuildResolves_ThenThePinIsUsed", () => {
    const resolved = buildRoute({ size: "S", overrides: { modelPin: claude("haiku") } }, defaults);
    expect(resolved).toMatchObject({ route: claude("haiku"), tier: "fast", skipped: [] });
  });

  it("GivenAPinOnADisabledProvider_WhenABuildResolves_ThenTheTierRouteAndWhyThePinWasSkipped", () => {
    const resolved = buildRoute({ size: "M", overrides: { modelPin: jules() } }, defaults);
    expect(resolved.route).toEqual(claude("opus"));
    expect(resolved.skipped[0]?.reason).toBe("the ticket's model pin: provider google-sub is off");
  });

  it("GivenAPin_WhenAFixedTierStepResolves_ThenThePinIsIgnoredLikeTheTierPin", () => {
    expect(
      buildRoute({ size: "M", overrides: { modelPin: claude("haiku") } }, defaults, "refine").route,
    ).toEqual(claude("sonnet"));
  });
});
