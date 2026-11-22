import { describe, expect, it } from "vitest";
import { ConfigChange } from "../entities";
import {
  CONFIG_CHANGE_LIST_MAX,
  GLOBAL_ENTITY_ID,
  configChangeId,
  type ConfigChangeLog,
} from "../ports/config-changes";

/** The applied log (M4.11). `make` must return a store with nothing in it. */
export function configChangeLogContract(name: string, make: () => Promise<ConfigChangeLog>) {
  describe(`ConfigChangeLog contract: ${name}`, () => {
    const start = Date.parse("2026-11-12T10:00:00.000Z");
    const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
    const change = (overrides: Partial<ConfigChange> = {}): ConfigChange =>
      ConfigChange.parse({
        id: crypto.randomUUID(),
        entity: "project",
        entityId: "ai",
        projectId: "ai",
        diff: { autoBuild: { from: false, to: true } },
        actor: "andy",
        reason: "",
        status: "applied",
        createdAt: at(0),
        appliedAt: at(0),
        ...overrides,
      });

    it("GivenAnAppendedChange_WhenReadById_ThenItComesBackUnchanged", async () => {
      const store = await make();
      const c = change();
      expect(await store.append(c)).toEqual(c);
      expect(await store.get(c.id)).toEqual(c);
      expect(await store.get("missing")).toBeNull();
    });

    it("GivenADuplicateId_WhenAppended_ThenConflictAndTheFirstStays", async () => {
      const store = await make();
      const c = change();
      await store.append(c);
      await expect(store.append({ ...c, reason: "again" })).rejects.toMatchObject({
        name: "WorkTrackerError",
        code: "conflict",
      });
      expect(await store.get(c.id)).toEqual(c);
    });

    it("GivenAnInvalidChange_WhenAppended_ThenRefusedAndNothingStored", async () => {
      const store = await make();
      const c = change();
      await expect(store.append({ ...c, actor: "nobody" } as never)).rejects.toThrow();
      expect(await store.get(c.id)).toBeNull();
    });

    it("GivenChanges_WhenListedForAProject_ThenNewestFirstAndOnlyThatProject", async () => {
      const store = await make();
      const old = change({ createdAt: at(0) });
      const recent = change({ createdAt: at(5) });
      await store.append(old);
      await store.append(recent);
      await store.append(change({ entityId: "other", projectId: "other" }));
      await store.append(change({ entity: "tier", entityId: "ai" }));
      const routing = change({ entity: "routing", createdAt: at(9) });
      await store.append(routing);
      await store.append(change({ entity: "routing", entityId: "global", projectId: null }));
      expect((await store.listForProject("ai")).map((c) => c.id)).toEqual([
        routing.id,
        recent.id,
        old.id,
      ]);
      expect(await store.listForProject("none")).toEqual([]);
    });

    it("GivenMilestoneChanges_WhenListedForAProject_ThenTheyShowByProjectId", async () => {
      const store = await make();
      const mine = change({
        entity: "milestone",
        entityId: "m1",
        projectId: "ai",
        createdAt: at(3),
      });
      const settings = change({ createdAt: at(1) });
      await store.append(mine);
      await store.append(settings);
      await store.append(change({ entity: "milestone", entityId: "m2", projectId: "other" }));
      expect((await store.listForProject("ai")).map((c) => c.id)).toEqual([mine.id, settings.id]);
      expect((await store.listForProject("other")).map((c) => c.entityId)).toEqual(["m2"]);
    });

    it("GivenGlobalAndProjectChanges_WhenListingGlobalForAnEntity_ThenOnlyItsGlobalOnesNewestFirst", async () => {
      const store = await make();
      const old = change({
        entity: "routing",
        entityId: GLOBAL_ENTITY_ID,
        projectId: null,
        createdAt: at(1),
      });
      const recent = change({
        entity: "routing",
        entityId: GLOBAL_ENTITY_ID,
        projectId: null,
        createdAt: at(4),
      });
      await store.append(old);
      await store.append(recent);
      await store.append(change({ entity: "routing" }));
      await store.append(change({ entity: "caps", entityId: GLOBAL_ENTITY_ID, projectId: null }));
      expect((await store.listGlobal("routing")).map((c) => c.id)).toEqual([recent.id, old.id]);
      expect((await store.listGlobal("routing", 1)).map((c) => c.id)).toEqual([recent.id]);
      expect(await store.listGlobal("none")).toEqual([]);
    });

    it("GivenChangesSavedInTheSameMillisecond_WhenListed_ThenNewestFirstByTheirIds", async () => {
      const store = await make();
      const same = new Date(start);
      const ids = [configChangeId(same), configChangeId(same), configChangeId(same)];
      for (const id of [ids[1], ids[2], ids[0]]) await store.append(change({ id }));
      expect((await store.listForProject("ai")).map((c) => c.id)).toEqual([ids[2], ids[1], ids[0]]);
    });

    it("GivenMoreChangesThanTheLimit_WhenListed_ThenOnlyTheNewestAreReturned", async () => {
      const store = await make();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push((await store.append(change({ createdAt: at(i) }))).id);
      expect((await store.listForProject("ai", 2)).map((c) => c.id)).toEqual([ids[2], ids[1]]);
      expect(CONFIG_CHANGE_LIST_MAX).toBeGreaterThan(2);
    });

    it("GivenAnAppliedChange_WhenMarkedReverted_ThenRevertedWithWhoAndWhen", async () => {
      const store = await make();
      const c = await store.append(change());
      const reverted = await store.markReverted(c.id, "andy", at(3));
      expect(reverted).toEqual({
        ...c,
        status: "reverted",
        decidedBy: "andy",
        decidedAt: at(3),
      });
      expect(await store.get(c.id)).toEqual(reverted);
    });

    it("GivenARevertedOrUnknownChange_WhenMarkedReverted_ThenConflictOrNotFound", async () => {
      const store = await make();
      const c = await store.append(change());
      await store.markReverted(c.id, "andy", at(3));
      await expect(store.markReverted(c.id, "andy", at(4))).rejects.toMatchObject({
        name: "WorkTrackerError",
        code: "conflict",
      });
      await expect(store.markReverted("missing", "andy", at(4))).rejects.toMatchObject({
        name: "WorkTrackerError",
        code: "not_found",
      });
    });
  });
}
