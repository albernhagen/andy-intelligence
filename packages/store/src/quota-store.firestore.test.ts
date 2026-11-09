import { quotaStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreQuotaStore } from "./quota-store";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  quotaStoreContract("firestore (emulator)", async () => {
    const existing = await db.collection("quotaReadings").get();
    await Promise.all(existing.docs.map((d) => d.ref.delete()));
    return new FirestoreQuotaStore(db);
  });
} else {
  describe("QuotaStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
