import { runStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreRunStore } from "./run-store";

/**
 * Why the race cases get 30 s, not vitest's 5 s default (AI-71, measured 2026-11-09):
 * - Two transactions read one run, then both commit. The emulator holds the conflicting commits
 *   for ~2 s, then aborts one or both (both in 61 of 80 local races).
 * - `@google-cloud/firestore` retries an aborted transaction up to 5 attempts, waiting
 *   1 s, 1.5 s, 2.25 s, 3.4 s (each ±50% jitter) before attempts 2–5.
 * - One collision costs ~2.5–3.5 s (every race in CI). When both abort and their retries collide
 *   again, that is another ~2 s wait plus a longer backoff: up to ~7.8 s, past 5 s. Worst case over
 *   all 5 attempts is ~22 s (5 × 2 s waits + 12.2 s backoff), so 30 s still fails a real hang.
 * The time is the emulator's lock wait and the client's backoff, not the adapter's transaction,
 * which is one read and one write.
 */
const EMULATOR_RACE_TIMEOUT_MS = 30_000;

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  runStoreContract("firestore (emulator)", async () => new FirestoreRunStore(db), {
    raceTimeoutMs: EMULATOR_RACE_TIMEOUT_MS,
  });
} else {
  describe("RunStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
