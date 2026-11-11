import { notifyLedgerContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreNotifyLedger } from "./notify-ledger";

// Runs only against the Firestore emulator: `pnpm test:firestore` (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  notifyLedgerContract(
    "firestore (emulator)",
    async () => new FirestoreNotifyLedger(db, `emailNotify-${crypto.randomUUID()}`),
  );
} else {
  describe("NotifyLedger contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
