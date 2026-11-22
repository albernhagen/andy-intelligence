import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTING,
  ROUTING_LIMITS,
  RoutingConfig,
  RoutingConfigInput,
  nextRoutingStamp,
} from "./routing";

/** AI-230: M9.3: the routing config schema and today's default. */
describe("routing config", () => {
  const { scope, projectId, providers, tiers, steps } = DEFAULT_ROUTING;
  const input: RoutingConfigInput = { scope, projectId, providers, tiers, steps };
  const edit = (change: (c: RoutingConfigInput) => void) => {
    const copy = structuredClone(input);
    change(copy);
    return RoutingConfigInput.safeParse(copy).success;
  };

  it("GivenTheDefault_WhenRead_ThenFastIsSonnetAndStrongIsOpusOnClaudeOnly", () => {
    const claude = { harness: "claude-code", provider: "claude-sub" };
    expect(DEFAULT_ROUTING.tiers.fast).toEqual([{ ...claude, model: "sonnet" }]);
    expect(DEFAULT_ROUTING.tiers.strong).toEqual([{ ...claude, model: "opus" }]);
    expect(DEFAULT_ROUTING.providers["claude-sub"].enabled).toBe(true);
    expect(DEFAULT_ROUTING.providers["google-sub"].enabled).toBe(false);
    expect(DEFAULT_ROUTING.providers.openrouter.enabled).toBe(false);
    expect(DEFAULT_ROUTING).toMatchObject({ scope: "global", projectId: null, updatedAt: null });
  });

  it("GivenTheDefault_WhenStepsRead_ThenRefineIsFastAndBuildFollowsSize", () => {
    expect(DEFAULT_ROUTING.steps).toMatchObject({
      refine: "fast",
      plan: "by_size",
      build: "by_size",
      sync: "by_size",
    });
  });

  it("GivenATierAtTheCap_WhenParsed_ThenAcceptedButOneMoreIsRefused", () => {
    const route = input.tiers.fast[0]!;
    const routes = (n: number) => Array.from({ length: n }, () => route);
    expect(edit((c) => (c.tiers.fast = routes(ROUTING_LIMITS.routesPerTier)))).toBe(true);
    expect(edit((c) => (c.tiers.fast = routes(ROUTING_LIMITS.routesPerTier + 1)))).toBe(false);
    expect(edit((c) => (c.tiers.fast = []))).toBe(false);
  });

  it("GivenWarnAbovePause_WhenParsed_ThenRefused", () => {
    expect(edit((c) => (c.providers["claude-sub"].warnPct = 90))).toBe(false);
  });

  it("GivenADailyTaskLimitOutsideGoogleSub_WhenParsed_ThenRefused", () => {
    expect(edit((c) => (c.providers["google-sub"].dailyTaskLimit = 15))).toBe(true);
    expect(edit((c) => (c.providers["claude-sub"].dailyTaskLimit = 15))).toBe(false);
  });

  it("GivenAScopeAndProjectIdThatDisagree_WhenParsed_ThenRefused", () => {
    expect(edit((c) => Object.assign(c, { scope: "project", projectId: "ai" }))).toBe(true);
    expect(edit((c) => (c.scope = "project"))).toBe(false);
    expect(edit((c) => (c.projectId = "ai"))).toBe(false);
    expect(edit((c) => Object.assign(c, { scope: "project", projectId: "a/b" }))).toBe(false);
  });

  it("GivenAMissingProviderOrTier_WhenParsed_ThenRefused", () => {
    expect(edit((c) => delete (c.providers as Partial<typeof c.providers>).openrouter)).toBe(false);
    expect(edit((c) => delete (c.tiers as Partial<typeof c.tiers>).cheap)).toBe(false);
  });

  it("GivenAConfigStoredBeforeAStepExisted_WhenParsed_ThenThatStepGetsItsDefaultTier", () => {
    const stored = { ...structuredClone(input), updatedAt: "2026-11-01T00:00:00.000Z" };
    delete (stored.steps as Partial<typeof stored.steps>).summarize;
    stored.steps.refine = "strong";
    const parsed = RoutingConfig.parse(stored);
    expect(parsed.steps.summarize).toBe("fast");
    expect(parsed.steps.refine).toBe("strong");
  });

  it("GivenAStepWithAnUnknownTier_WhenParsed_ThenRefused", () => {
    expect(edit((c) => Object.assign(c.steps, { scout: "huge" }))).toBe(false);
  });

  it("GivenAStoredConfigWithoutAStamp_WhenParsed_ThenRefused", () => {
    expect(RoutingConfig.safeParse(input).success).toBe(false);
  });

  it("GivenAPreviousStampInTheFuture_WhenStamped_ThenOneMillisecondLater", () => {
    expect(nextRoutingStamp("2026-11-21T10:00:00.000Z", new Date("2026-11-21T09:00:00.000Z"))).toBe(
      "2026-11-21T10:00:00.001Z",
    );
    expect(nextRoutingStamp(null, new Date("2026-11-21T09:00:00.000Z"))).toBe(
      "2026-11-21T09:00:00.000Z",
    );
  });
});
