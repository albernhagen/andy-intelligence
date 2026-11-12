import { configChangeLogContract, configChangeStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { FirestoreConfigChangeStore } from "./config-change-store";
import { createFirestore } from "./index";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  configChangeStoreContract(
    "firestore (emulator)",
    async () => {
      const existing = await db.collection("configChanges").get();
      await Promise.all(existing.docs.map((d) => d.ref.delete()));
      return new FirestoreConfigChangeStore(db);
    },
    // Three transactions on one query: the emulator's lock wait plus client backoff (AI-71).
    { raceTimeoutMs: 30_000 },
  );
  // The applied log (M4.11), in this file so the two suites never clear the collection at once.
  configChangeLogContract("firestore (emulator)", async () => {
    const existing = await db.collection("configChanges").get();
    await Promise.all(existing.docs.map((d) => d.ref.delete()));
    return new FirestoreConfigChangeStore(db);
  });
} else {
  describe("ConfigChangeStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
