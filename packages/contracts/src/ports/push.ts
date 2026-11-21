import type { PushSendState, PushSettings, PushSubscription } from "../entities/push";

// ── PushSubscriptionStore ────────────────────────────────────────────────────
// Web Push subscriptions, settings and send counts per user (M7.7, ADR-0052). Storage only:
// caps, quiet hours and payloads are the push policy (M7.8). Endpoints are untrusted input:
// stored here, never called. Reads are bounded: a user holds at most
// PUSH_SUBSCRIPTIONS_PER_USER_MAX subscriptions. A uid outside `PushUid` is rejected.

export interface PushSubscriptionStore {
  /**
   * Stores the subscription, replacing any with the same endpoint (whoever held it). When the
   * user already holds the maximum, the least recently used (`lastUsedAt`, else `createdAt`) of
   * the others is deleted first. Atomic: concurrent saves can't exceed the maximum.
   */
  save(subscription: PushSubscription): Promise<void>;
  /** Deletes the subscription with this endpoint; false when there was none. */
  deleteByEndpoint(endpoint: string): Promise<boolean>;
  /** The user's subscriptions, oldest first (`createdAt`, then endpoint). */
  listByUid(uid: string): Promise<PushSubscription[]>;
  /** Deletes every subscription the user holds (sign-out everywhere, removed from the allow-list); returns how many. */
  deleteAllForUid(uid: string): Promise<number>;
  /** The user's settings; null before the first put. */
  getSettings(uid: string): Promise<PushSettings | null>;
  /** Stores the settings, replacing the previous ones. */
  putSettings(settings: PushSettings): Promise<void>;
  /**
   * Reads the user's send state, applies `change` and writes the state it returns, in one
   * atomic step, so two concurrent sends can't both pass a cap. `change` may run more than once,
   * so it must be pure. The returned state's `uid` must be `uid`. Returns `change`'s result.
   */
  updateSendState<T>(
    uid: string,
    change: (state: PushSendState | null) => { state: PushSendState; result: T },
  ): Promise<T>;
}
