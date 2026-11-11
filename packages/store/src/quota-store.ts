import type { Firestore } from "@google-cloud/firestore";
import {
  QuotaClear,
  QuotaReading,
  quotaClearId,
  type ProviderKey,
  type QuotaDiscard,
  type QuotaStore,
  type QuotaWindow,
} from "@andy/contracts";
import { collections, typedCollection } from "./index";

/**
 * QuotaStore on Firestore: one document per provider and window, holding the latest reading, and
 * one per clear Andy made (AI-74), kept after the next reading replaces the cleared one.
 */
export class FirestoreQuotaStore implements QuotaStore {
  constructor(private readonly db: Firestore) {}

  private collection() {
    return typedCollection(this.db, collections.quotaReadings.path(), QuotaReading);
  }

  private clears() {
    return typedCollection(this.db, collections.quotaClears.path(), QuotaClear);
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

  /** One small transaction: at most two reading and two clear documents (one per window). */
  async discard(
    provider: ProviderKey,
    readings: { window: QuotaWindow; takenAt: string }[],
    by: QuotaDiscard,
  ): Promise<QuotaClear[]> {
    return this.db.runTransaction(async (tx) => {
      const targets = readings.map(({ window, takenAt }) => ({
        window,
        takenAt,
        reading: this.collection().doc(`${provider}_${window}`),
        clear: this.clears().doc(quotaClearId(provider, window, takenAt)),
      }));
      const snaps = await Promise.all(
        targets.map(async (t) => ({
          ...t,
          stored: await tx.get(t.reading),
          done: await tx.get(t.clear),
        })),
      );
      const made: QuotaClear[] = [];
      for (const { window, takenAt, reading, clear, stored, done } of snaps) {
        const r = stored.data();
        if (!r || r.takenAt !== takenAt || r.discarded || done.exists) continue;
        const record: QuotaClear = {
          id: clear.id,
          provider,
          window,
          usedPct: r.usedPct,
          readingTakenAt: takenAt,
          by: by.by,
          at: by.at,
        };
        tx.set(reading, { ...r, discarded: by });
        tx.create(clear, record);
        made.push(record);
      }
      return made;
    });
  }

  /**
   * A range on `at` alone needs no composite index; the provider is filtered after the limit.
   * Only `claude-sub` is cleared today, so the limit is exact; revisit with a second provider.
   */
  async clearsSince(provider: ProviderKey, since: string, limit: number): Promise<QuotaClear[]> {
    const snap = await this.clears()
      .where("at", ">=", since)
      .orderBy("at", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data()).filter((c) => c.provider === provider);
  }
}
