import {
  PUSH_SUBSCRIPTIONS_PER_USER_MAX,
  PushSendState,
  PushSettings,
  PushSubscription,
  PushUid,
  byPushSubscriptionAge,
  pushSubscriptionToEvict,
} from "../entities/push";
import type { PushSubscriptionStore } from "../ports/push";

/** In-memory PushSubscriptionStore: synchronous updates, so atomic within one process. */
export class InMemoryPushSubscriptionStore implements PushSubscriptionStore {
  private readonly subs = new Map<string, PushSubscription>();
  private readonly settings = new Map<string, PushSettings>();
  private readonly sendStates = new Map<string, PushSendState>();

  async save(subscription: PushSubscription): Promise<void> {
    const parsed = PushSubscription.parse(subscription);
    this.subs.delete(parsed.endpoint);
    const held = this.ofUid(parsed.uid);
    if (held.length >= PUSH_SUBSCRIPTIONS_PER_USER_MAX) {
      const evict = pushSubscriptionToEvict(held);
      if (evict) this.subs.delete(evict.endpoint);
    }
    this.subs.set(parsed.endpoint, parsed);
  }

  async deleteByEndpoint(endpoint: string): Promise<boolean> {
    return this.subs.delete(endpoint);
  }

  async listByUid(uid: string): Promise<PushSubscription[]> {
    PushUid.parse(uid);
    return this.ofUid(uid)
      .sort(byPushSubscriptionAge)
      .map((s) => structuredClone(s));
  }

  async deleteAllForUid(uid: string): Promise<number> {
    PushUid.parse(uid);
    const held = this.ofUid(uid);
    for (const s of held) this.subs.delete(s.endpoint);
    return held.length;
  }

  async getSettings(uid: string): Promise<PushSettings | null> {
    PushUid.parse(uid);
    const s = this.settings.get(uid);
    return s ? structuredClone(s) : null;
  }

  async putSettings(settings: PushSettings): Promise<void> {
    const parsed = PushSettings.parse(settings);
    this.settings.set(parsed.uid, parsed);
  }

  async updateSendState<T>(
    uid: string,
    change: (state: PushSendState | null) => { state: PushSendState; result: T },
  ): Promise<T> {
    PushUid.parse(uid);
    const current = this.sendStates.get(uid);
    const { state, result } = change(current ? structuredClone(current) : null);
    const parsed = PushSendState.parse(state);
    if (parsed.uid !== uid) throw new Error(`send state for ${parsed.uid} written as ${uid}`);
    this.sendStates.set(uid, parsed);
    return result;
  }

  private ofUid(uid: string): PushSubscription[] {
    return [...this.subs.values()].filter((s) => s.uid === uid);
  }
}
