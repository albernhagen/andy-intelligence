import { DEFAULT_ROUTING, type RoutingConfig, type TicketOverrides } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { routeLayers } from "./route-layers";

/** AI-282: M9: which layer set a ticket's worker, tier and route. */

const sonnet = DEFAULT_ROUTING.tiers.fast[0]!;
const opus = DEFAULT_ROUTING.tiers.strong[0]!;
const project = { defaultWorker: "agent" as const };
const ticket = (overrides: TicketOverrides = {}, size: "S" | "M" | null = "S") => ({
  size,
  overrides,
});
const epic = (overrides: TicketOverrides) => ({ key: "AI-225", overrides });

/** A project config: global's routes, with these changes. */
const projectConfig = (changes: Partial<RoutingConfig> = {}): RoutingConfig => ({
  ...structuredClone(DEFAULT_ROUTING),
  scope: "project",
  projectId: "ai",
  ...changes,
});

const layers = (
  t: ReturnType<typeof ticket>,
  e: ReturnType<typeof epic> | null = null,
  own: RoutingConfig | null = null,
) => routeLayers({ ticket: t, epic: e, project, global: DEFAULT_ROUTING, projectConfig: own });

describe("routeLayers (AI-282)", () => {
  it("GivenNoOverridesAndNoProjectConfig_WhenRead_ThenProjectWorkerAndGlobalTierAndRoute", () => {
    const r = layers(ticket());
    expect(r.step).toBe("build");
    expect(r.worker).toEqual({ value: "agent", layer: "project", epicKey: null, note: null });
    expect(r.tier).toMatchObject({ value: "fast", layer: "global", note: "size S → fast" });
    expect(r.route).toMatchObject({ value: sonnet, layer: "global" });
    expect(r.skipped).toEqual([]);
  });

  it("GivenAnEpicTierAndAssignee_WhenRead_ThenBothNameTheEpic", () => {
    const r = layers(ticket(), epic({ tier: "strong", assignee: "me" }));
    expect(r.worker).toMatchObject({ value: "me", layer: "epic", epicKey: "AI-225" });
    expect(r.tier).toMatchObject({ value: "strong", layer: "epic", epicKey: "AI-225" });
    expect(r.route.value).toEqual(opus);
  });

  it("GivenTicketAndEpicBothSetATier_WhenRead_ThenTheTicketOverrideWins", () => {
    const r = layers(ticket({ tier: "fast" }), epic({ tier: "strong" }));
    expect(r.tier).toMatchObject({ value: "fast", layer: "ticket", epicKey: null });
  });

  it("GivenAProjectConfig_WhenRead_ThenTheRouteIsTheProjectDefault", () => {
    const r = layers(ticket(), null, projectConfig());
    expect(r.route).toMatchObject({ value: sonnet, layer: "project" });
  });

  it("GivenAFixedStepTierInTheProjectConfig_WhenRead_ThenTheTierIsTheProjectDefault", () => {
    const own = projectConfig({ steps: { ...DEFAULT_ROUTING.steps, build: "strong" } });
    const r = layers(ticket(), null, own);
    expect(r.tier).toMatchObject({
      value: "strong",
      layer: "project",
      note: "the build step's tier",
    });
  });

  it("GivenAUsableEpicModelPin_WhenRead_ThenTheRouteNamesTheEpic", () => {
    const r = layers(ticket(), epic({ modelPin: opus }));
    expect(r.route).toEqual({ value: opus, layer: "epic", epicKey: "AI-225", note: "model pin" });
  });

  it("GivenAPinTheProjectLeavesOut_WhenRead_ThenItIsSkippedWithTheResolversReason", () => {
    const own = projectConfig({
      tiers: { ...DEFAULT_ROUTING.tiers, frontier: [], strong: [] },
    });
    const r = layers(ticket({ modelPin: opus }), null, own);
    expect(r.skipped).toEqual([
      { route: opus, reason: "the ticket's model pin: not a route in this project's routing" },
    ]);
    expect(r.route).toMatchObject({ value: sonnet, layer: "project" });
  });

  it("GivenNoSize_WhenRead_ThenTheTierNoteSaysSo", () => {
    expect(layers(ticket({}, null)).tier).toMatchObject({
      value: "fast",
      note: "no size yet, so fast",
    });
  });
});
