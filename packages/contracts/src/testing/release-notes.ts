import { describe, expect, it } from "vitest";
import { ReleaseNote, releaseNoteId } from "../entities/release-notes";
import { RELEASE_NOTE_LIST_MAX, type ReleaseNoteStore } from "../ports/release-notes";

/** AI-159. `make` must return a store with nothing in it. Timestamps are UTC with a `Z`. */
export function releaseNoteStoreContract(name: string, make: () => Promise<ReleaseNoteStore>) {
  describe(`ReleaseNoteStore contract: ${name}`, () => {
    const start = Date.parse("2026-11-20T10:00:00.000Z");
    const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
    const note = (prNumber: number, overrides: Partial<ReleaseNote> = {}): ReleaseNote =>
      ReleaseNote.parse({
        id: releaseNoteId(prNumber),
        projectId: "ai",
        prNumber,
        prUrl: `https://github.com/a/b/pull/${prNumber}`,
        prTitle: `AI-${prNumber}: Thing`,
        ticketKey: `AI-${prNumber}`,
        ticketTitle: "Thing",
        risk: "low",
        mergedAt: at(prNumber),
        mergedBy: "albernhagen",
        source: "note",
        whatChanged: "Andy can see a thing.",
        howItWorks: "A route reads it.",
        needsYou: null,
        links: [
          {
            kind: "adr",
            path: "docs/architecture/adr/0121-x.md",
            url: "https://github.com/a/b/blob/HEAD/docs/architecture/adr/0121-x.md",
          },
        ],
        recordedAt: at(prNumber),
        ...overrides,
      });

    it("GivenAPutNote_WhenReadById_ThenItComesBackUnchanged", async () => {
      const store = await make();
      const n = note(1);
      expect(await store.put(n)).toEqual(n);
      expect(await store.get("ai", n.id)).toEqual(n);
      expect(await store.get("ai", "pr-999")).toBeNull();
      expect(await store.get("other", n.id)).toBeNull();
    });

    it("GivenANoteForThePr_WhenPutAgain_ThenItIsReplaced", async () => {
      const store = await make();
      await store.put(note(1));
      await store.put(note(1, { whatChanged: "Edited." }));
      expect((await store.get("ai", "pr-1"))?.whatChanged).toBe("Edited.");
    });

    it("GivenANoteForThePr_WhenCreated_ThenExistsAndTheFirstStays", async () => {
      const store = await make();
      expect(await store.create(note(1))).toBe("created");
      expect(await store.create(note(1, { source: "backfill", whatChanged: "Old." }))).toBe(
        "exists",
      );
      expect((await store.get("ai", "pr-1"))?.source).toBe("note");
    });

    it("GivenAnInvalidNote_WhenPut_ThenRefusedAndNothingStored", async () => {
      const store = await make();
      await expect(store.put({ ...note(1), whatChanged: "x".repeat(401) })).rejects.toThrow();
      expect(await store.get("ai", "pr-1")).toBeNull();
    });

    it("GivenNotes_WhenListed_ThenNewestMergeFirstOnlyThisProjectInsideTheWindow", async () => {
      const store = await make();
      for (const n of [1, 2, 3, 4]) await store.put(note(n));
      await store.put(note(5, { projectId: "other" }));
      expect((await store.listForProject("ai")).map((n) => n.prNumber)).toEqual([4, 3, 2, 1]);
      const window = { since: at(2), until: at(4) };
      expect((await store.listForProject("ai", window)).map((n) => n.prNumber)).toEqual([3, 2]);
      expect(await store.listForProject("none")).toEqual([]);
    });

    it("GivenMoreNotesThanTheLimit_WhenListed_ThenOnlyTheNewest", async () => {
      const store = await make();
      for (const n of [1, 2, 3]) await store.put(note(n));
      const listed = await store.listForProject("ai", { limit: 2 });
      expect(listed.map((n) => n.prNumber)).toEqual([3, 2]);
      expect(RELEASE_NOTE_LIST_MAX).toBeGreaterThan(2);
    });
  });
}
