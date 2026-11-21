import type {
  ProviderSpendTotals,
  SpendCapName,
  SpendCapLimits,
  SpendEntry,
  SpendTotals,
} from "../entities/spend";

// ── SpendLedger ──────────────────────────────────────────────────────────────
// Errors are WorkTrackerError (`conflict`), mapped the same way by the API.
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
   * with the same terms (`sameSpendReservation`) returns that entry, counted once (a retried
   * reserve); with other terms it is a `WorkTrackerError` `conflict` and nothing changes.
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
  /**
   * The same totals split by provider (AI-280): one row per `ProviderKey`, in its declared
   * order, zero for a provider with no spend. Every entry names its provider (required since
   * AI-234), so there is no unknown row. Bounded: one total per provider and window.
   */
  totalsByProvider(scope: { projectId?: string }, at: string): Promise<ProviderSpendTotals[]>;
}

/** A retried reserve matches the recorded one: same run, project, provider, model, amount and time. */
export function sameSpendReservation(recorded: SpendEntry, retry: SpendEntry): boolean {
  return (
    recorded.id === retry.id &&
    recorded.runId === retry.runId &&
    recorded.projectId === retry.projectId &&
    recorded.provider === retry.provider &&
    recorded.model === retry.model &&
    recorded.reservedMicroUsd === retry.reservedMicroUsd &&
    Date.parse(recorded.at) === Date.parse(retry.at)
  );
}
