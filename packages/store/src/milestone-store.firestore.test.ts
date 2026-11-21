import { milestoneStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { collections, createFirestore } from "./index";
import { FirestoreMilestoneStore } from "./milestone-store";

/** Filling the cap writes 50 documents and racing transactions back off: 60 s. */
const EMULATOR_SLOW_TIMEOUT_MS = 60_000;

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  milestoneStoreContract(
    "firestore (emulator)",
    async () => {
      for (const projectId of ["p1", "p2"]) {
        const existing = await db.collection(collections.milestones.path(projectId)).get();
        await Promise.all(existing.docs.map((d) => d.ref.delete()));
      }
      return new FirestoreMilestoneStore(db);
    },
    { slowTimeoutMs: EMULATOR_SLOW_TIMEOUT_MS },
  );
} else {
  describe("MilestoneStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
