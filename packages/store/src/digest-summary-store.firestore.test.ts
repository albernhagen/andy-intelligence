import { digestSummaryStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { FirestoreDigestSummaryStore } from "./digest-summary-store";
import { createFirestore } from "./index";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  digestSummaryStoreContract("firestore (emulator)", async () => {
    const paths = [
      "digestSummaryDays",
      "projects/ai/digestSummaries",
      "projects/other/digestSummaries",
    ];
    for (const path of paths) {
      const existing = await db.collection(path).get();
      await Promise.all(existing.docs.map((d) => d.ref.delete()));
    }
    return new FirestoreDigestSummaryStore(db);
  });
} else {
  describe("DigestSummaryStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
