import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { routeKey, routingErrors } from "./routing-errors";

describe("routingErrors", () => {
  it("GivenARouteRefusal_WhenMapped_ThenItSitsOnThatRouteAlone", () => {
    const err = new ApiError(422, "a route can't run", [
      "tier fast, route 2: harness jules doesn't run on provider claude-sub (it needs google-sub)",
    ]);
    const mapped = routingErrors(err);
    expect(mapped.routes.get(routeKey("fast", 1))).toBe(
      "harness jules doesn't run on provider claude-sub (it needs google-sub)",
    );
    expect(mapped.general).toEqual([]);
  });

  it("GivenARefusalNotAboutARoute_WhenMapped_ThenItIsGeneralWithTheMessage", () => {
    const err = new ApiError(422, "a project's routing may only narrow global", [
      "provider google-sub is off globally",
    ]);
    expect(routingErrors(err)).toEqual({
      routes: new Map(),
      general: [
        "a project's routing may only narrow global",
        "provider google-sub is off globally",
      ],
    });
  });

  it("GivenAConflictWithoutDetails_WhenMapped_ThenTheMessageIsGeneral", () => {
    expect(routingErrors(new ApiError(409, "routing changed since it was read")).general).toEqual([
      "routing changed since it was read",
    ]);
  });

  it("GivenNoError_WhenMapped_ThenNothing", () => {
    expect(routingErrors(null)).toEqual({ routes: new Map(), general: [] });
  });
});
