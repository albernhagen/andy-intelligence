import type { EmailNotifyState } from "../entities/notify-email";

// ── NotifyLedger ─────────────────────────────────────────────────────────────
// The email notifier's stored state (AI-77): the day's count and the open batching window.
// One record for the whole control plane (one recipient).

export interface NotifyLedger {
  /** The stored state; null before the first write. */
  get(): Promise<EmailNotifyState | null>;
  /**
   * Reads the state, applies `change` and writes the state it returns, in one atomic step: two
   * concurrent updates never both see the same state. `change` may run more than once, so it
   * must be pure. Returns `change`'s result.
   */
  update<T>(
    change: (state: EmailNotifyState | null) => { state: EmailNotifyState; result: T },
  ): Promise<T>;
}

/** Delayed flushes of the batching window (AI-77): delivers one call at `at`. */
export interface NotifyFlushQueue {
  /** Idempotent per `at`: a second schedule for the same instant queues nothing. */
  schedule(at: string): Promise<void>;
}
