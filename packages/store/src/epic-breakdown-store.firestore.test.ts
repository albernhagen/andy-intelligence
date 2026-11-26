import { epicBreakdownStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { FirestoreEpicBreakdownStore } from "./epic-breakdown-store";
import { collections, createFirestore } from "./index";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  epicBreakdownStoreContract("firestore (emulator)", async () => {
    for (const projectId of ["p1", "p2"]) {
      const existing = await db.collection(collections.epicBreakdowns.path(projectId)).get();
      await Promise.all(existing.docs.map((d) => d.ref.delete()));
    }
    return new FirestoreEpicBreakdownStore(db);
  });
} else {
  describe("EpicBreakdownStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
