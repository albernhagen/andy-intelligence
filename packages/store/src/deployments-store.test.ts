import { deploymentStoreContract } from "@andy/contracts/testing";
import { describe, expect, it } from "vitest";
import {
  DEPLOYMENTS_COLLECTION,
  FirestoreDeploymentStore,
  deploymentKey,
} from "./deployments-store";
import { createFirestore } from "./index";

describe("deploymentKey", () => {
  it("GivenTwoStartTimes_WhenKeyed_ThenTheNewerSortsFirstAsText", () => {
    const older = deploymentKey("2026-11-20T10:00:00.000Z");
    const newer = deploymentKey("2026-11-20T10:00:00.001Z");
    expect(newer < older).toBe(true);
    expect(newer).toMatch(/^\d{13}-[0-9a-f-]{36}$/);
  });
});

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  deploymentStoreContract(
    "firestore (emulator)",
    async () => {
      const existing = await db.collection(DEPLOYMENTS_COLLECTION).get();
      await Promise.all(existing.docs.map((d) => d.ref.delete()));
      return new FirestoreDeploymentStore(db);
    },
    // The cap case writes 101 documents one by one.
    { timeoutMs: 60_000 },
  );
} else {
  describe("DeploymentStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
