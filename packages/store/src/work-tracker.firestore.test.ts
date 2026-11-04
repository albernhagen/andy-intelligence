import { workTrackerContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreWorkTracker } from "./work-tracker";

// Runs only against the Firestore emulator: `pnpm test:firestore` (needs Java), locally or in
// CI's `firestore-suite` job when the adapters change (ADR-0045).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  workTrackerContract("firestore (emulator)", async () => new FirestoreWorkTracker(db));
} else {
  describe("WorkTracker contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
