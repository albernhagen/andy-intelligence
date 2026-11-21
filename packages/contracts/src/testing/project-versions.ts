import { describe, expect, it } from "vitest";
import type { ProjectVersions } from "../ports/project-versions";

/** `make` must return a store with no counters in it. */
export function projectVersionsContract(name: string, make: () => Promise<ProjectVersions>): void {
  describe(`ProjectVersions contract: ${name}`, () => {
    it("GivenANewProject_WhenRead_ThenZero", async () => {
      expect(await (await make()).get("ai")).toBe(0);
    });

    it("GivenBumps_WhenRead_ThenEachCountsOncePerProject", async () => {
      const versions = await make();
      await versions.bump("ai");
      await versions.bump("ai");
      await versions.bump("ops");
      expect(await versions.get("ai")).toBe(2);
      expect(await versions.get("ops")).toBe(1);
    });

    it("GivenConcurrentBumps_WhenRead_ThenNoneIsLost", async () => {
      const versions = await make();
      await Promise.all(Array.from({ length: 5 }, () => versions.bump("ai")));
      expect(await versions.get("ai")).toBe(5);
    });
  });
}
