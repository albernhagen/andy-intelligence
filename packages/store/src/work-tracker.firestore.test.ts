import { workTrackerContract } from "@andy/contracts/testing";
import { describe, expect, it } from "vitest";
import { collections, createFirestore } from "./index";
import { FirestoreWorkTracker } from "./work-tracker";

// Runs only against the Firestore emulator: `pnpm test:firestore` (needs Java), locally or in
// CI's `firestore-suite` job when the adapters change (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  workTrackerContract("firestore (emulator)", async () => new FirestoreWorkTracker(db));

  describe("FirestoreWorkTracker: ticket model v2 upgrade (ADR-0058)", () => {
    it("GivenAStoredV1Ticket_WhenReadListedAndUpdated_ThenItIsUpgradedAndRewrittenAsV2", async () => {
      const tracker = new FirestoreWorkTracker(db);
      const key = `U${crypto
        .randomUUID()
        .slice(0, 6)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "X")}`;
      const project = await tracker.createProject({ name: "Upgrade", key });
      const fresh = await tracker.createTicket(project.id, { title: "Old" }, "andy");
      // Overwrite it with the v1 shape, as the live store has it before this deploy.
      const raw = db.collection(collections.tickets.path(project.id)).doc(fresh.id);
      const old: Record<string, unknown> = {
        ...fresh,
        type: "story",
        tier: "fast",
        needsYou: true,
      };
      for (const added of ["needsAttention", "outOfScope", "touches"]) delete old[added];
      await raw.set({ ...old, _v: 1 });

      expect(await tracker.getTicket(project.id, fresh.id)).toMatchObject({
        type: "feature",
        needsAttention: true,
        outOfScope: [],
        touches: [],
      });
      const flagged = await tracker.listTickets(project.id, { needsAttention: true });
      expect(flagged.map((t) => t.id)).toEqual([fresh.id]);

      await tracker.updateTicket(project.id, fresh.id, { fields: { body: "intent" } }, "andy");
      const stored = (await raw.get()).data();
      expect(stored).toMatchObject({ _v: 2, type: "feature", needsAttention: true });
      expect(stored).not.toHaveProperty("needsYou");
      expect(stored).not.toHaveProperty("tier");
    });
  });
} else {
  describe("WorkTracker contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
