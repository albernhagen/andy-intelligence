import { codeEventLogContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { FirestoreCodeEventLog } from "./code-event-log";
import { createFirestore } from "./index";

// Runs only against the Firestore emulator: `pnpm test:firestore` (ADR-0034).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  codeEventLogContract("firestore (emulator)", async () => new FirestoreCodeEventLog(db));
} else {
  describe("CodeEventLog contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
