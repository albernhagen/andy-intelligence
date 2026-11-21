import { spendNoticeLedgerContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreSpendNoticeLedger } from "./spend-notice-ledger";

// Runs only against the Firestore emulator: `pnpm test:firestore` (ADR-0048). Racing updates of
// one document get 30 s, as in `notify-ledger.firestore.test.ts` (AI-138).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  spendNoticeLedgerContract(
    "firestore (emulator)",
    async () => new FirestoreSpendNoticeLedger(db, `spendNotices-${crypto.randomUUID()}`),
    { raceTimeoutMs: 30_000 },
  );
} else {
  describe("SpendNoticeLedger contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
