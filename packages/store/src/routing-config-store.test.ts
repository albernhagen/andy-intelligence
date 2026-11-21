import { routingConfigStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreRoutingConfigStore, ROUTING_CONFIGS_COLLECTION } from "./routing-config-store";

/**
 * Why the racing case gets 30 s, not vitest's 5 s default (AI-283; same cause as AI-138 in
 * `notify-ledger.firestore.test.ts`): two puts with the same stamp are two transactions on one
 * document. The emulator holds the conflicting commit ~2 s, then aborts it; `@google-cloud/
 * firestore` retries after ~1 s (±50% jitter), and the loser then reads the new stamp and throws
 * `conflict`. One collision settles in ~3 s; a second passes 5 s (it timed out once on `main` at
 * 109fd2b). Production Firestore aborts a contended commit in milliseconds, so the store needs no
 * change: a two-editor put settles after one retry. 30 s still fails a real hang.
 */
const EMULATOR_RACE_TIMEOUT_MS = 30_000;

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  routingConfigStoreContract(
    "firestore (emulator)",
    async (now) => {
      const existing = await db.collection(ROUTING_CONFIGS_COLLECTION).get();
      await Promise.all(existing.docs.map((d) => d.ref.delete()));
      return new FirestoreRoutingConfigStore(db, now);
    },
    { raceTimeoutMs: EMULATOR_RACE_TIMEOUT_MS },
  );
} else {
  describe("RoutingConfigStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
