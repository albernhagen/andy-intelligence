import { runnerStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreRunnerStore } from "./runner-store";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  runnerStoreContract(
    "firestore (emulator)",
    async (now) => {
      for (const name of ["runners", "runTokens"]) {
        const existing = await db.collection(name).get();
        await Promise.all(existing.docs.map((d) => d.ref.delete()));
      }
      return new FirestoreRunnerStore(db, now);
    },
    // Three transactions on one document: the emulator's lock wait plus client backoff (AI-71).
    { raceTimeoutMs: 30_000 },
  );
} else {
  describe("RunnerStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
