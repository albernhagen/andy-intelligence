import { projectVersionsContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreProjectVersions } from "./project-versions";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  projectVersionsContract("firestore (emulator)", async () => {
    const existing = await db.collection("projectVersions").get();
    await Promise.all(existing.docs.map((d) => d.ref.delete()));
    return new FirestoreProjectVersions(db);
  });
} else {
  describe("ProjectVersions contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
