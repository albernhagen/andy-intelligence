import { reviewFindingLogContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreReviewFindingLog } from "./review-finding-log";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  reviewFindingLogContract("firestore (emulator)", async () => {
    const existing = await db.collection("reviewVerdicts").get();
    await Promise.all(existing.docs.map((d) => d.ref.delete()));
    return new FirestoreReviewFindingLog(db);
  });
} else {
  describe("ReviewFindingLog contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
