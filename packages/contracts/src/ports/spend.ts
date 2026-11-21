import type { SpendCapName, SpendCapLimits, SpendEntry, SpendTotals } from "../entities/spend";

// ── SpendLedger ──────────────────────────────────────────────────────────────
// Append-only record of paid spend (M10: Paid models + spend caps, AI-234: M10.2). Entries are
// never deleted: a reservation only moves to `settled` or `released`. Totals are per scope and
// UTC window, so a read never scans the whole ledger (ADR-0126; the Firestore adapter, M10.6,
// keeps one total document per scope and window).

export type ReserveOutcome =
  | { ok: true; entry: SpendEntry }
  /** Nothing was recorded: this reservation would pass `cap`. */
  | { ok: false; cap: SpendCapName; limitMicroUsd: number; usedMicroUsd: number };

export interface SpendLedger {
  /**
   * Records `entry` (state `reserved`) unless its `reservedMicroUsd`, added to its project's and
   * the global totals for its UTC day and month, would pass a cap; then records nothing and says
   * which. Atomic: concurrent reservations can't together pass a cap. An id already recorded
   * returns that entry, counted once (a retried reserve).
   */
  reserve(entry: SpendEntry, caps: SpendCapLimits): Promise<ReserveOutcome>;
  /**
   * Settles a reservation at its actual cost; `null` (cost unknown) keeps the full reservation.
   * Idempotent: a settled or released entry comes back unchanged. Null for an unknown id.
   */
  settle(id: string, microUsd: number | null, at: string): Promise<SpendEntry | null>;
  /** Releases a reservation (the task never ran): it counts nothing. Idempotent like `settle`. */
  release(id: string, at: string): Promise<SpendEntry | null>;
  get(id: string): Promise<SpendEntry | null>;
  /**
   * What counts in the UTC day and month of `at`: one project's entries, or every project's
   * with no `projectId`. Entries count in the window they were reserved in.
   */
  totals(scope: { projectId?: string }, at: string): Promise<SpendTotals>;
}
