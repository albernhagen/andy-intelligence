import type { Firestore } from "@google-cloud/firestore";
import {
  SpendCaps,
  StoredSpendCaps,
  WorkTrackerError,
  nextSpendCapsStamp,
  type SpendCapsStore,
} from "@andy/contracts";
import { zodConverter } from "./index";

/**
 * `settings/spendCaps`: server-only, like every collection (the rules deny all client access).
 * A new document: nothing to migrate, no SCHEMA_VERSION bump.
 */
export const SETTINGS_COLLECTION = "settings";
export const SPEND_CAPS_DOC = "spendCaps";

/** SpendCapsStore on Firestore (AI-276). One document; every read is one get. */
export class FirestoreSpendCapsStore implements SpendCapsStore {
  constructor(
    private readonly db: Firestore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private doc() {
    return this.db
      .collection(SETTINGS_COLLECTION)
      .withConverter(zodConverter(StoredSpendCaps))
      .doc(SPEND_CAPS_DOC);
  }

  async getGlobal(): Promise<StoredSpendCaps | null> {
    return (await this.doc().get()).data() ?? null;
  }

  async putGlobal(caps: SpendCaps, ifUpdatedAt: string | null): Promise<StoredSpendCaps> {
    const parsed = SpendCaps.parse(caps);
    const ref = this.doc();
    return this.db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data()?.updatedAt ?? null;
      if (current !== ifUpdatedAt) {
        throw new WorkTrackerError(
          "conflict",
          "the global spend caps changed since they were read",
        );
      }
      const next = StoredSpendCaps.parse({
        ...parsed,
        updatedAt: nextSpendCapsStamp(current, this.now()),
      });
      tx.set(ref, next);
      return next;
    });
  }
}
