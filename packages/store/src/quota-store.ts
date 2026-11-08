import type { Firestore } from "@google-cloud/firestore";
import { QuotaReading, type ProviderKey, type QuotaStore } from "@andy/contracts";
import { collections, typedCollection } from "./index";

/** QuotaStore on Firestore: one document per provider and window, holding the latest reading. */
export class FirestoreQuotaStore implements QuotaStore {
  constructor(private readonly db: Firestore) {}

  private collection() {
    return typedCollection(this.db, collections.quotaReadings.path(), QuotaReading);
  }

  async save(readings: QuotaReading[]): Promise<void> {
    const batch = this.db.batch();
    for (const r of readings) batch.set(this.collection().doc(`${r.provider}_${r.window}`), r);
    await batch.commit();
  }

  async latest(provider: ProviderKey): Promise<QuotaReading[]> {
    const snap = await this.collection().where("provider", "==", provider).get();
    return snap.docs.map((d) => d.data());
  }
}
