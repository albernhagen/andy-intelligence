import type { SpendNoticeState } from "../entities/spend-notices";

// ── SpendNoticeLedger ────────────────────────────────────────────────────────
// What the spend notices have sent (AI-257: M10.9), so dedupe and the daily cap hold across
// instances and restarts. One record for the control plane, like `NotifyLedger`.

export interface SpendNoticeLedger {
  /** The stored state; null before the first write. */
  get(): Promise<SpendNoticeState | null>;
  /**
   * Reads the state, applies `change` and writes the state it returns, in one atomic step: two
   * concurrent updates never both see the same state, so a notice can't go out twice. `change`
   * may run more than once, so it must be pure. Returns `change`'s result.
   */
  update<T>(
    change: (state: SpendNoticeState | null) => { state: SpendNoticeState; result: T },
  ): Promise<T>;
}
