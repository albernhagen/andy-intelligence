import { spendLedgerContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreSpendLedger, SPEND_COLLECTION, SPEND_TOTALS_COLLECTION } from "./spend-ledger";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  spendLedgerContract(
    "firestore (emulator)",
    async () => {
      // Every collection the ledger writes, so each case starts empty.
      for (const name of [SPEND_COLLECTION, SPEND_TOTALS_COLLECTION]) {
        const existing = await db.collection(name).get();
        await Promise.all(existing.docs.map((d) => d.ref.delete()));
      }
      return new FirestoreSpendLedger(db);
    },
    // Two transactions on the same total documents: the emulator's lock wait plus client
    // backoff (AI-71, AI-138), as in `notify-ledger.firestore.test.ts`.
    { raceTimeoutMs: 30_000 },
  );
} else {
  describe("SpendLedger contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
