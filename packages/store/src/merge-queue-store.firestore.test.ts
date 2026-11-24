import { mergeQueueStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreMergeQueueStore, MERGE_QUEUES_COLLECTION } from "./merge-queue-store";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  mergeQueueStoreContract("firestore (emulator)", async () => {
    await db.recursiveDelete(db.collection(MERGE_QUEUES_COLLECTION));
    return new FirestoreMergeQueueStore(db);
  });
} else {
  describe("MergeQueueStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
