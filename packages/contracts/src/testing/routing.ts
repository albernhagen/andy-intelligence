import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTING, ROUTING_LIMITS, type RoutingConfigInput } from "../entities/routing";
import type { RoutingConfigStore } from "../ports/routing";

/** `make` must return an empty store whose clock is `now`. */
export function routingConfigStoreContract(
  name: string,
  make: (now: () => Date) => Promise<RoutingConfigStore>,
): void {
  describe(`RoutingConfigStore contract: ${name}`, () => {
    let clock = new Date("2026-11-21T10:00:00.000Z");
    const fresh = () => {
      clock = new Date("2026-11-21T10:00:00.000Z");
      return make(() => clock);
    };
    const { scope, projectId, providers, tiers, steps } = DEFAULT_ROUTING;
    const defaults: RoutingConfigInput = { scope, projectId, providers, tiers, steps };
    const global = (): RoutingConfigInput => structuredClone(defaults);
    const project = (projectId = "ai"): RoutingConfigInput => ({
      ...global(),
      scope: "project",
      projectId,
    });
    const isConflict = (err: unknown) => (err as { code?: string }).code === "conflict";

    it("GivenNothingStored_WhenRead_ThenGlobalIsTheDefaultAndAProjectHasNone", async () => {
      const store = await fresh();
      expect(await store.getGlobal()).toEqual(DEFAULT_ROUTING);
      expect(await store.getProject("ai")).toBeNull();
    });

    it("GivenNothingStored_WhenGlobalIsPutWithNull_ThenItIsStoredAndStamped", async () => {
      const store = await fresh();
      const edited = global();
      edited.providers["google-sub"] = {
        ...edited.providers["google-sub"],
        enabled: true,
        dailyTaskLimit: 15,
      };
      const saved = await store.put(edited, null);
      expect(saved).toEqual({ ...edited, updatedAt: clock.toISOString() });
      expect(await store.getGlobal()).toEqual(saved);
    });

    it("GivenAStoredConfig_WhenPutWithAStaleOrNullStamp_ThenConflictAndNothingWritten", async () => {
      const store = await fresh();
      const first = await store.put(global(), null);
      clock = new Date(clock.getTime() + 60_000);
      const second = await store.put(
        { ...global(), steps: { ...global().steps, refine: "strong" } },
        first.updatedAt,
      );

      for (const stale of [first.updatedAt, null, "2026-11-21T09:00:00.000Z"]) {
        await expect(store.put(global(), stale)).rejects.toSatisfy(isConflict);
      }
      expect(await store.getGlobal()).toEqual(second);
    });

    it("GivenNothingStoredForAProject_WhenPutWithAStamp_ThenConflict", async () => {
      const store = await fresh();
      await expect(store.put(project(), "2026-11-21T10:00:00.000Z")).rejects.toSatisfy(isConflict);
      expect(await store.getProject("ai")).toBeNull();
    });

    it("GivenTwoPutsInOneMillisecond_WhenStamped_ThenTheSecondIsLaterAndTheFirstStampIsStale", async () => {
      const store = await fresh();
      const first = await store.put(global(), null);
      const second = await store.put(global(), first.updatedAt);
      expect(Date.parse(second.updatedAt!)).toBeGreaterThan(Date.parse(first.updatedAt!));
      await expect(store.put(global(), first.updatedAt)).rejects.toSatisfy(isConflict);
    });

    it("GivenAProjectConfig_WhenPut_ThenOnlyThatProjectHasItAndGlobalIsUnchanged", async () => {
      const store = await fresh();
      const narrowed = project("ai");
      narrowed.providers["claude-sub"] = { ...narrowed.providers["claude-sub"], reservePct: 40 };
      const saved = await store.put(narrowed, null);
      expect(await store.getProject("ai")).toEqual(saved);
      expect(await store.getProject("ops")).toBeNull();
      expect(await store.getGlobal()).toEqual(DEFAULT_ROUTING);
    });

    it("GivenATierWithTooManyRoutes_WhenPut_ThenRefusedAndNothingWritten", async () => {
      const store = await fresh();
      const tooMany = global();
      const route = tooMany.tiers.fast[0]!;
      tooMany.tiers.fast = Array.from({ length: ROUTING_LIMITS.routesPerTier + 1 }, () => route);
      await expect(store.put(tooMany, null)).rejects.toThrow();
      expect(await store.getGlobal()).toEqual(DEFAULT_ROUTING);
    });

    it("GivenAProjectIdThatIsNotAProjectKey_WhenPutOrRead_ThenRefusedAndNothingWritten", async () => {
      const store = await fresh();
      for (const bad of ["a/b", "AI", "../global", ""]) {
        await expect(store.put(project(bad), null)).rejects.toThrow();
        expect(await store.getProject(bad)).toBeNull();
      }
      expect(await store.getGlobal()).toEqual(DEFAULT_ROUTING);
    });

    it("GivenTwoEditorsWithTheSameStamp_WhenBothPut_ThenExactlyOneWins", async () => {
      const store = await fresh();
      const base = await store.put(global(), null);
      const results = await Promise.allSettled([
        store.put({ ...global(), steps: { ...global().steps, review: "strong" } }, base.updatedAt),
        store.put({ ...global(), steps: { ...global().steps, review: "cheap" } }, base.updatedAt),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected");
      expect(isConflict(lost?.reason)).toBe(true);
    });
  });
}
