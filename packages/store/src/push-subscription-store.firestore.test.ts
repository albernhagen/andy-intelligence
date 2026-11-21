import { pushSubscriptionStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestorePushSubscriptionStore } from "./push-subscription-store";

/**
 * Racing cases get 30 s, as in `notify-ledger.firestore.test.ts` (AI-138): concurrent
 * transactions on one document or query make the emulator abort and the client back off.
 */
const EMULATOR_RACE_TIMEOUT_MS = 30_000;

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  pushSubscriptionStoreContract(
    "firestore (emulator)",
    async () => {
      // Every collection the store writes, so each case starts empty.
      for (const name of ["pushSubscriptions", "pushSettings", "pushSendStates"]) {
        const existing = await db.collection(name).get();
        await Promise.all(existing.docs.map((d) => d.ref.delete()));
      }
      return new FirestorePushSubscriptionStore(db);
    },
    { raceTimeoutMs: EMULATOR_RACE_TIMEOUT_MS },
  );
} else {
  describe("PushSubscriptionStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
