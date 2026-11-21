import { routingConfigStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreRoutingConfigStore, ROUTING_CONFIGS_COLLECTION } from "./routing-config-store";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  routingConfigStoreContract("firestore (emulator)", async (now) => {
    const existing = await db.collection(ROUTING_CONFIGS_COLLECTION).get();
    await Promise.all(existing.docs.map((d) => d.ref.delete()));
    return new FirestoreRoutingConfigStore(db, now);
  });
} else {
  describe("RoutingConfigStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
