import { describe, expect, it } from "vitest";
import { LAYER_ORDER_LINE } from "@/lib/route-layers";

describe("layer order line", () => {
  it("GivenMilestonesAreTheirOwnThing_WhenTheLineRenders_ThenItNamesOnlyTheFourLayers", () => {
    // AI-327: ADR-0131 retired "a milestone is an epic titled M<N>".
    expect(LAYER_ORDER_LINE).toBe(
      "Who sets a ticket's worker, tier and route, first match wins: ticket override, then epic override, then project default, then global.",
    );
  });
});
