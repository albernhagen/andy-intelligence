import { describe, expect, it } from "vitest";
import {
  MILESTONES_PER_PROJECT_MAX,
  type Milestone,
  type MilestoneInput,
} from "../entities/milestone";
import type { MilestoneStore } from "../ports/milestone-store";

export const milestone = (over: Partial<MilestoneInput> = {}): MilestoneInput => ({
  id: "m1",
  projectId: "p1",
  name: "M1: Foundations",
  outcome: "Andy signs in and sees his tickets.",
  order: 1,
  createdAt: "2026-11-21T12:00:00.000Z",
  updatedAt: "2026-11-21T12:00:00.000Z",
  ...over,
});

export interface MilestoneStoreContractOptions {
  /** Timeout (ms) for cases that race transactions or write a cap's worth of rows. */
  slowTimeoutMs?: number;
}

/** `make` must return a store with nothing in it for projects `p1` and `p2`. */
export function milestoneStoreContract(
  name: string,
  make: () => Promise<MilestoneStore>,
  options: MilestoneStoreContractOptions = {},
): void {
  const itSlow = (title: string, fn: () => Promise<void>) => it(title, fn, options.slowTimeoutMs);
  const ids = (ms: Milestone[]) => ms.map((m) => m.id);
  const fill = async (store: MilestoneStore, count: number) => {
    for (let n = 0; n < count; n++) {
      await store.create(milestone({ id: `m${n}`, order: n }));
    }
  };

  describe(`MilestoneStore contract: ${name}`, () => {
    it("GivenNothingStored_WhenRead_ThenNone", async () => {
      const store = await make();
      expect(await store.list("p1")).toEqual([]);
      expect(await store.get("p1", "m1")).toBeNull();
    });

    it("GivenANewMilestone_WhenCreated_ThenStoredNotReviewedAndReadBack", async () => {
      const store = await make();
      const created = await store.create(milestone());
      expect(created).toEqual({ ...milestone(), status: "not_reviewed" });
      expect(await store.get("p1", "m1")).toEqual(created);
      expect(await store.list("p1")).toEqual([created]);
    });

    it("GivenSeveralProjects_WhenListed_ThenOnlyThatProjectInRoadmapOrder", async () => {
      const store = await make();
      await store.create(milestone({ id: "late", name: "B", order: 2 }));
      await store.create(milestone({ id: "tie-b", name: "B", order: 1 }));
      await store.create(milestone({ id: "tie-a", name: "A", order: 1 }));
      await store.create(milestone({ id: "other", projectId: "p2", order: 0 }));
      expect(ids(await store.list("p1"))).toEqual(["tie-a", "tie-b", "late"]);
      expect(ids(await store.list("p2"))).toEqual(["other"]);
      expect(await store.get("p2", "late")).toBeNull();
    });

    it("GivenAnExistingId_WhenCreatedAgain_ThenRefusedAndUnchanged", async () => {
      const store = await make();
      await store.create(milestone());
      await expect(store.create(milestone({ name: "Other" }))).rejects.toThrow();
      expect((await store.get("p1", "m1"))?.name).toBe("M1: Foundations");
    });

    it("GivenAnInvalidMilestone_WhenCreated_ThenRejectedAndNothingStored", async () => {
      const store = await make();
      await expect(store.create(milestone({ outcome: "x".repeat(301) }))).rejects.toThrow();
      await expect(store.create(milestone({ name: " " }))).rejects.toThrow();
      await expect(store.create(milestone({ id: "a/b" }))).rejects.toThrow();
      await expect(store.create(milestone({ order: 1.5 }))).rejects.toThrow();
      await expect(
        store.create(milestone({ status: "done" as MilestoneInput["status"] })),
      ).rejects.toThrow();
      expect(await store.list("p1")).toEqual([]);
    });

    it("GivenAMilestone_WhenReplaced_ThenTheNewFieldsAreStored", async () => {
      const store = await make();
      await store.create(milestone());
      const replaced = await store.replace(
        milestone({ status: "approved", order: 5, updatedAt: "2026-11-22T12:00:00.000Z" }),
      );
      expect(replaced).toMatchObject({ status: "approved", order: 5 });
      expect(await store.get("p1", "m1")).toEqual(replaced);
    });

    it("GivenNoSuchMilestone_WhenReplaced_ThenNullAndNothingStored", async () => {
      const store = await make();
      expect(await store.replace(milestone({ status: "parked" }))).toBeNull();
      expect(await store.list("p1")).toEqual([]);
    });

    itSlow("GivenAFullProject_WhenAnotherIsCreated_ThenRefusedNamingTheCap", async () => {
      const store = await make();
      await fill(store, MILESTONES_PER_PROJECT_MAX);
      const refused = store.create(milestone({ id: "late", order: 99 }));
      await expect(refused).rejects.toMatchObject({ cap: "MILESTONES_PER_PROJECT_MAX" });
      await expect(refused).rejects.toThrow(/MILESTONES_PER_PROJECT_MAX/);
      // Another project has its own cap, and replacing in a full project is still allowed.
      await store.create(milestone({ projectId: "p2" }));
      await store.replace(milestone({ id: "m0", order: 0, status: "parked" }));
      expect(await store.list("p1")).toHaveLength(MILESTONES_PER_PROJECT_MAX);
    });

    itSlow("GivenOneSlotLeft_WhenTwoCreatesRace_ThenOnlyOneLands", async () => {
      const store = await make();
      await fill(store, MILESTONES_PER_PROJECT_MAX - 1);
      const results = await Promise.allSettled([
        store.create(milestone({ id: "race-a", order: 98 })),
        store.create(milestone({ id: "race-b", order: 99 })),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await store.list("p1")).toHaveLength(MILESTONES_PER_PROJECT_MAX);
    });
  });
}
