import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { makeRouter } from "@/router";
import { ALL } from "@/lib/scope";
import { REACHED_OTHERWISE, shellLinks } from "@/lib/shell-routes";

/** AI-370: every route in `router.tsx` stays reachable from the shell. */
describe("shell routes", () => {
  const router = makeRouter(createMemoryHistory({ initialEntries: ["/"] }));
  const paths = Object.keys(router.routesByPath).filter((p) => p !== "__root__");
  const linked = new Set(
    [...shellLinks({ kind: "project", projectId: "ai" }), ...shellLinks(ALL)].map((l) => l.to),
  );
  const asUrl = (path: string) => path.replace("$projectId", "ai").replace(/\/$/, "") || "/";

  it("GivenTheRouter_WhenEachRouteIsChecked_ThenTheShellLinksItOrSaysHowItIsReached", () => {
    expect(paths.length).toBeGreaterThan(20);
    const orphans = paths.filter((p) => !(p in REACHED_OTHERWISE) && !linked.has(asUrl(p)));
    expect(orphans).toEqual([]);
  });

  it("GivenTheExceptions_WhenCheckedAgainstTheRouter_ThenEachIsStillARoute", () => {
    for (const path of Object.keys(REACHED_OTHERWISE)) expect(paths).toContain(path);
  });
});
