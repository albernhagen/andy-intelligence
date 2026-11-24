import { describe, expect, it } from "vitest";
import { SCREENS } from "../e2e/screens";
import { makeRouter } from "./router";

/** Full paths of the routes that render a page; redirect-only routes have no component. */
function pageRoutes(): string[] {
  const router = makeRouter();
  return Object.values(router.routesById)
    .filter((route) => !route.isRoot && route.options.component !== undefined)
    .map((route) => route.fullPath);
}

describe("screenshot coverage (AI-366)", () => {
  it("GivenTheRouter_WhenListingPageRoutes_ThenEachHasAScreenshotCase", () => {
    const covered = new Set(SCREENS.map((s) => s.route));
    const missing = pageRoutes().filter((path) => !covered.has(path));
    expect(missing, "add these routes to apps/web/e2e/screens.ts").toEqual([]);
  });

  it("GivenTheScreenshotCases_WhenMatchedToTheRouter_ThenNoneNamesAMissingRoute", () => {
    const routes = new Set(pageRoutes());
    expect(SCREENS.filter((s) => !routes.has(s.route)).map((s) => s.route)).toEqual([]);
  });

  it("GivenTheScreenshotCases_WhenNamingImages_ThenNamesAreUnique", () => {
    const names = SCREENS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
