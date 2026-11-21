import { releaseNoteStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreReleaseNoteStore } from "./release-note-store";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  releaseNoteStoreContract("firestore (emulator)", async () => {
    for (const projectId of ["ai", "other", "none"]) {
      const existing = await db.collection(`projects/${projectId}/releaseNotes`).get();
      await Promise.all(existing.docs.map((d) => d.ref.delete()));
    }
    return new FirestoreReleaseNoteStore(db);
  });
} else {
  describe("ReleaseNoteStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
