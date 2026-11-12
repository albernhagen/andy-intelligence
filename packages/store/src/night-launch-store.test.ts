import { nightLaunchStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreNightLaunchStore } from "./night-launch-store";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  nightLaunchStoreContract(
    "firestore (emulator)",
    async () => {
      const existing = await db.collection("nightLaunches").get();
      await Promise.all(existing.docs.map((d) => d.ref.delete()));
      return new FirestoreNightLaunchStore(db);
    },
    // Three transactions on one project's launches: lock wait plus client backoff (AI-71).
    { raceTimeoutMs: 30_000 },
  );
} else {
  describe("NightLaunchStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
