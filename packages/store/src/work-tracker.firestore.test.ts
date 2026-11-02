import { workTrackerContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreWorkTracker } from "./work-tracker";

// Runs only against the Firestore emulator: `pnpm test:firestore` (needs Java). CI runs the
// same suite on the in-memory fake only (ADR-0034).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  workTrackerContract("firestore (emulator)", async () => new FirestoreWorkTracker(db));
} else {
  describe("WorkTracker contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
