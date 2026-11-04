import { oauthGrantStoreContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreOAuthGrantStore } from "./oauth-grant-store";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  oauthGrantStoreContract(
    "firestore (emulator)",
    async (now) => new FirestoreOAuthGrantStore(db, now),
  );
} else {
  describe("OAuthGrantStore contract: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
