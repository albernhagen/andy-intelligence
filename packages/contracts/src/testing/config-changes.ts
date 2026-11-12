import { describe, expect, it } from "vitest";
import { ConfigChange } from "../entities";
import { CONFIG_CHANGE_LIST_MAX, type ConfigChangeStore } from "../ports/config-changes";

/** `make` must return a store with nothing in it. */
export function configChangeStoreContract(name: string, make: () => Promise<ConfigChangeStore>) {
  describe(`ConfigChangeStore contract: ${name}`, () => {
    const start = Date.parse("2026-11-12T10:00:00.000Z");
    const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
    const change = (overrides: Partial<ConfigChange> = {}): ConfigChange =>
      ConfigChange.parse({
        id: crypto.randomUUID(),
        entity: "project",
        entityId: "ai",
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
      await store.append(change({ entityId: "other" }));
      await store.append(change({ entity: "tier", entityId: "ai" }));
      expect((await store.listForProject("ai")).map((c) => c.id)).toEqual([recent.id, old.id]);
      expect(await store.listForProject("none")).toEqual([]);
    });

    it("GivenMoreChangesThanTheLimit_WhenListed_ThenOnlyTheNewestAreReturned", async () => {
      const store = await make();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push((await store.append(change({ createdAt: at(i) }))).id);
      expect((await store.listForProject("ai", 2)).map((c) => c.id)).toEqual([ids[2], ids[1]]);
      expect(CONFIG_CHANGE_LIST_MAX).toBeGreaterThan(2);
    });
  });
}
