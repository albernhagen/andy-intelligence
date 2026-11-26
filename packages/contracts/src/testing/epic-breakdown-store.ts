import { describe, expect, it } from "vitest";
import type { EpicBreakdown } from "../entities/epic-breakdown";
import { WorkTrackerError } from "../ports";
import type { EpicBreakdownStore } from "../ports/epic-breakdown-store";

export const breakdown = (over: Partial<EpicBreakdown> = {}): EpicBreakdown => ({
  projectId: "p1",
  epicId: "e1",
  status: "proposed",
  proposal: {
    summary: "Two tickets.",
    tickets: [
      {
        title: "Log a run",
        type: "feature",
        size: "S",
        sizeReason: "One form.",
        body: "A form that saves a run.",
        acceptanceCriteria: ["When Andy saves a run, the system shall list it."],
        touches: ["apps/web/**"],
        blockedBy: [],
      },
    ],
  },
  proposedBy: "agent:r1",
  proposedAt: "2026-11-25T12:00:00.000Z",
  decidedBy: null,
  decidedAt: null,
  reason: null,
  ticketIds: [],
  updatedAt: "2026-11-25T12:00:00.000Z",
  ...over,
});

/** `make` must return a store with nothing in it for projects `p1` and `p2`. */
export function epicBreakdownStoreContract(
  name: string,
  make: () => Promise<EpicBreakdownStore>,
): void {
  describe(`EpicBreakdownStore contract: ${name}`, () => {
    it("GivenNothingStored_WhenRead_ThenNone", async () => {
      const store = await make();
      expect(await store.get("p1", "e1")).toBeNull();
      expect(await store.listWaiting("p1")).toEqual([]);
    });

    it("GivenANewBreakdown_WhenPutAsNew_ThenReadBack", async () => {
      const store = await make();
      const stored = await store.put(breakdown(), null);
      expect(stored).toEqual(breakdown());
      expect(await store.get("p1", "e1")).toEqual(breakdown());
      expect(await store.get("p2", "e1")).toBeNull();
    });

    it("GivenAStoredBreakdown_WhenPutAsNewAgain_ThenConflictAndNothingWritten", async () => {
      const store = await make();
      await store.put(breakdown(), null);
      const err = await store.put(breakdown({ reason: "x" }), null).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WorkTrackerError);
      expect((err as WorkTrackerError).code).toBe("conflict");
      expect((await store.get("p1", "e1"))?.reason).toBeNull();
    });

    it("GivenAStoredBreakdown_WhenPutWithItsStamp_ThenReplaced", async () => {
      const store = await make();
      const first = await store.put(breakdown(), null);
      const next = breakdown({
        status: "rejected",
        reason: "Too big.",
        updatedAt: "2026-11-25T13:00:00.000Z",
      });
      await store.put(next, first.updatedAt);
      expect(await store.get("p1", "e1")).toEqual(next);
    });

    it("GivenAStoredBreakdown_WhenPutWithAStaleStamp_ThenConflict", async () => {
      const store = await make();
      await store.put(breakdown(), null);
      const err = await store
        .put(breakdown({ status: "rejected" }), "2026-01-01T00:00:00.000Z")
        .catch((e: unknown) => e);
      expect((err as WorkTrackerError).code).toBe("conflict");
    });

    it("GivenBreakdownsInEveryStatus_WhenListingWaiting_ThenOnlyProposedAndApprovingOfThatProject", async () => {
      const store = await make();
      await store.put(breakdown({ epicId: "e1", status: "proposed" }), null);
      await store.put(breakdown({ epicId: "e2", status: "approving" }), null);
      await store.put(breakdown({ epicId: "e3", status: "approved" }), null);
      await store.put(breakdown({ epicId: "e4", status: "rejected" }), null);
      await store.put(breakdown({ projectId: "p2", epicId: "e5" }), null);
      const ids = (await store.listWaiting("p1")).map((b) => b.epicId).sort();
      expect(ids).toEqual(["e1", "e2"]);
    });
  });
}
