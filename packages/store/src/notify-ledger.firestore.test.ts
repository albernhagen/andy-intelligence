import { notifyLedgerContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreNotifyLedger } from "./notify-ledger";

/**
 * Why the racing case gets 30 s, not vitest's 5 s default (AI-138; cause measured in AI-71, see
 * `run-store.firestore.test.ts`): five transactions update one ledger document at once. The
 * emulator holds conflicting commits ~2 s, then aborts one or more; `@google-cloud/firestore`
 * retries after 1 s, 1.5 s, 2.25 s, 3.4 s (±50% jitter), 5 attempts in all. A second collision
 * passes 5 s (it failed at 5003 ms on `main` at 7e1186d). One transaction's worst case over all
 * 5 attempts is ~22 s, so 30 s still fails a real hang. The time is the emulator's lock wait and
 * the client's backoff, not the adapter, whose transaction is one read and one write.
 */
const EMULATOR_RACE_TIMEOUT_MS = 30_000;

// Runs only against the Firestore emulator: `pnpm test:firestore` (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  notifyLedgerContract(
    "firestore (emulator)",
    async () => new FirestoreNotifyLedger(db, `emailNotify-${crypto.randomUUID()}`),
    { raceTimeoutMs: EMULATOR_RACE_TIMEOUT_MS },
  );
} else {
  describe("NotifyLedger contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
