import { membershipStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreMembershipStore, MEMBERSHIPS_COLLECTION } from "./membership-store";

/** Filling a cap writes up to 100 documents and racing transactions back off: 60 s. */
const EMULATOR_SLOW_TIMEOUT_MS = 60_000;

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  membershipStoreContract(
    "firestore (emulator)",
    async () => {
      const existing = await db.collection(MEMBERSHIPS_COLLECTION).get();
      await Promise.all(existing.docs.map((d) => d.ref.delete()));
      return new FirestoreMembershipStore(db);
    },
    { slowTimeoutMs: EMULATOR_SLOW_TIMEOUT_MS },
  );
} else {
  describe("MembershipStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
