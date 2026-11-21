import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import {
  PUSH_SUBSCRIPTIONS_PER_USER_MAX,
  PushSendState,
  PushSettings,
  PushSubscription,
  PushUid,
  byPushSubscriptionAge,
  pushSubscriptionToEvict,
  type PushSubscriptionStore,
} from "@andy/contracts";
import { collections, typedCollection } from "./index";

/**
 * A guard on one user's subscription query (ADR-0028). `save` keeps a user at
 * PUSH_SUBSCRIPTIONS_PER_USER_MAX, so this is never reached in practice.
 */
export const PUSH_SUBSCRIPTION_READ_MAX = 50;

/** Endpoints are long URLs with slashes, so a subscription's document id is their SHA-256. */
export const pushSubscriptionDocId = (endpoint: string) =>
  createHash("sha256").update(endpoint).digest("hex");

/**
 * PushSubscriptionStore on Firestore (M7.7, ADR-0052), server-only (the rules deny every client
 * read and write): `pushSubscriptions/{sha256(endpoint)}`, `pushSettings/{uid}`,
 * `pushSendStates/{uid}`. The per-user maximum and send counts are updated inside transactions
 * (serializable, queries included), so concurrent writes can't pass them. The one query is an
 * equality filter on `uid`, sorted in memory: no composite index.
 */
export class FirestorePushSubscriptionStore implements PushSubscriptionStore {
  constructor(private readonly db: Firestore) {}

  private subs() {
    return typedCollection(this.db, collections.pushSubscriptions.path(), PushSubscription);
  }

  private ofUid(uid: string) {
    return this.subs().where("uid", "==", PushUid.parse(uid)).limit(PUSH_SUBSCRIPTION_READ_MAX);
  }

  private settingsDoc(uid: string) {
    return typedCollection(this.db, collections.pushSettings.path(), PushSettings).doc(
      PushUid.parse(uid),
    );
  }

  private sendStateDoc(uid: string) {
    return typedCollection(this.db, collections.pushSendStates.path(), PushSendState).doc(
      PushUid.parse(uid),
    );
  }

  async save(subscription: PushSubscription): Promise<void> {
    const parsed = PushSubscription.parse(subscription);
    await this.db.runTransaction(async (tx) => {
      const others = (await tx.get(this.ofUid(parsed.uid))).docs
        .map((d) => d.data())
        .filter((s) => s.endpoint !== parsed.endpoint);
      if (others.length >= PUSH_SUBSCRIPTIONS_PER_USER_MAX) {
        const evict = pushSubscriptionToEvict(others);
        if (evict) tx.delete(this.subs().doc(pushSubscriptionDocId(evict.endpoint)));
      }
      tx.set(this.subs().doc(pushSubscriptionDocId(parsed.endpoint)), parsed);
    });
  }

  async deleteByEndpoint(endpoint: string): Promise<boolean> {
    const ref = this.subs().doc(pushSubscriptionDocId(endpoint));
    return this.db.runTransaction(async (tx) => {
      if (!(await tx.get(ref)).exists) return false;
      tx.delete(ref);
      return true;
    });
  }

  async listByUid(uid: string): Promise<PushSubscription[]> {
    return (await this.ofUid(uid).get()).docs.map((d) => d.data()).sort(byPushSubscriptionAge);
  }

  async deleteAllForUid(uid: string): Promise<number> {
    const snap = await this.ofUid(uid).get();
    if (snap.empty) return 0;
    const batch = this.db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    return snap.size;
  }

  async getSettings(uid: string): Promise<PushSettings | null> {
    return (await this.settingsDoc(uid).get()).data() ?? null;
  }

  async putSettings(settings: PushSettings): Promise<void> {
    const parsed = PushSettings.parse(settings);
    await this.settingsDoc(parsed.uid).set(parsed);
  }

  async updateSendState<T>(
    uid: string,
    change: (state: PushSendState | null) => { state: PushSendState; result: T },
  ): Promise<T> {
    const ref = this.sendStateDoc(uid);
    return this.db.runTransaction(async (tx) => {
      const { state, result } = change((await tx.get(ref)).data() ?? null);
      const parsed = PushSendState.parse(state);
      if (parsed.uid !== uid) throw new Error(`send state for ${parsed.uid} written as ${uid}`);
      tx.set(ref, parsed);
      return result;
    });
  }
}
