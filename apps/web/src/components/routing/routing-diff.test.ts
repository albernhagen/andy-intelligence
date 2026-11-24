import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTING } from "@andy/contracts";
import { routingChanges, type RoutingFields } from "./routing-diff";

/** AI-376: Models: the save bar's list of unsaved changes, in words. */

const base = (): RoutingFields =>
  structuredClone({
    providers: DEFAULT_ROUTING.providers,
    tiers: DEFAULT_ROUTING.tiers,
    steps: DEFAULT_ROUTING.steps,
  });

describe("routingChanges", () => {
  it("GivenNoEdit_WhenCompared_ThenNoChanges", () => {
    expect(routingChanges(base(), base())).toEqual([]);
  });

  it("GivenARouteAddedAtTheEnd_WhenCompared_ThenItNamesTheTierAndRoute", () => {
    const draft = base();
    draft.tiers.fast = [
      ...draft.tiers.fast,
      { harness: "opencode", provider: "openrouter", model: "x" },
    ];
    expect(routingChanges(base(), draft)).toEqual([
      { part: "tier:fast", summary: "Fast: added route 2" },
    ]);
  });

  it("GivenReorderedRemovedAndEditedRoutes_WhenCompared_ThenEachSaysWhatHappened", () => {
    const saved = base();
    saved.tiers.cheap = [
      { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
      { harness: "claude-code", provider: "claude-sub", model: "haiku" },
    ];
    saved.tiers.strong = [...saved.tiers.cheap];
    const draft = structuredClone(saved);
    draft.tiers.cheap.reverse();
    draft.tiers.strong = [draft.tiers.strong[0]!];
    draft.tiers.frontier = [{ ...draft.tiers.frontier[0]!, model: "opus-4" }];
    expect(routingChanges(saved, draft).map((c) => c.summary)).toEqual([
      "Frontier: route 1 now Opus 4",
      "Strong: removed a route",
      "Cheap: routes reordered",
    ]);
  });

  it("GivenAStepAndAProvider_WhenChanged_ThenTheyReadInPlainNames", () => {
    const draft = base();
    draft.steps.build = "frontier";
    draft.providers.openrouter = { ...draft.providers.openrouter, enabled: true };
    draft.providers["claude-sub"] = { ...draft.providers["claude-sub"], warnPct: 60 };
    expect(routingChanges(base(), draft)).toEqual([
      { part: "step:build", summary: "Build: By size → Frontier" },
      { part: "provider:claude-sub", summary: "Claude subscription: warn 60%" },
      { part: "provider:openrouter", summary: "OpenRouter: on" },
    ]);
  });
});
