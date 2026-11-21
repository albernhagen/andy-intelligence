import { spendCapsStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreSpendCapsStore, SETTINGS_COLLECTION, SPEND_CAPS_DOC } from "./spend-caps-store";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  spendCapsStoreContract("firestore (emulator)", async (now) => {
    await db.collection(SETTINGS_COLLECTION).doc(SPEND_CAPS_DOC).delete();
    return new FirestoreSpendCapsStore(db, now);
  });
} else {
  describe("SpendCapsStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
