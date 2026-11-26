import { releaseRequestStoreContract } from "@andy/contracts/testing";
import {
  FirestoreReleaseRequestStore,
  RELEASE_REQUESTS_COLLECTION,
  RELEASE_REQUEST_LOCKS_COLLECTION,
} from "./release-request-store";
import { createFirestore } from "./index";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  releaseRequestStoreContract(
    "firestore (emulator)",
    async () => {
      for (const name of [RELEASE_REQUESTS_COLLECTION, RELEASE_REQUEST_LOCKS_COLLECTION]) {
        const existing = await db.collection(name).get();
        await Promise.all(existing.docs.map((d) => d.ref.delete()));
      }
      return new FirestoreReleaseRequestStore(db);
    },
    // The cap case writes 51 documents one by one.
    { timeoutMs: 30_000 },
  );
}
