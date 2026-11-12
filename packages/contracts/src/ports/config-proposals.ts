import type { ConfigChange, Listing } from "../entities";
import type { ReviewFinding } from "../entities/config-proposals";

// ── ReviewFindingSource ──────────────────────────────────────────────────────
// The PR review agents' findings, as stored by the control plane (ADR-0097). Read-only here:
// the writer (a callback from the review workflow) is PR B of ADR-0097. Finding text is
// untrusted data.

export interface RecentFindingsQuery {
  /** Findings from the project's `maxPulls` most recently reviewed PRs only. */
  maxPulls: number;
  /** At most this many findings in all (ADR-0028). */
  maxFindings: number;
}

export interface ReviewFindingSource {
  /** The project's findings from its most recently reviewed PRs, newest first. */
  recent(projectId: string, query: RecentFindingsQuery): Promise<ReviewFinding[]>;
}

// ── ConfigChangeStore ────────────────────────────────────────────────────────
// Audited configuration changes (ARCHITECTURE §5). Proposals are `pending` until Andy decides.
// Nothing here applies a change: no method moves a change to `applied` (M4 config editing).
// Errors are WorkTrackerError (`not_found`, `conflict`), mapped the same way by the API.

/** What `createPending` did: stored it, found an equal pending one, or hit the pending cap. */
export type CreatePendingOutcome =
  | { outcome: "created"; change: ConfigChange }
  | { outcome: "duplicate"; change: ConfigChange }
  | { outcome: "capped"; change: null };

/** The decisions Andy makes on a pending change; neither applies it. */
export type ConfigChangeDecision = "accepted" | "rejected";

export interface ConfigChangeStore {
  /**
   * Stores a `pending` change, atomically: when a pending change with the same `dedupeKey`
   * exists it comes back instead (`duplicate`); when its project (`projectId`, null included)
   * already has `maxPending` pending changes nothing is written (`capped`). Concurrent calls
   * can't pass either check together.
   */
  createPending(change: ConfigChange, maxPending: number): Promise<CreatePendingOutcome>;
  get(id: string): Promise<ConfigChange | null>;
  /**
   * Every pending change (of one project when given), newest first. Complete: `createPending`
   * caps pending changes per project, so this list is bounded without a read cap of its own.
   */
  listPending(projectId?: string): Promise<ConfigChange[]>;
  /**
   * The most recently decided change (accepted or rejected, by `decidedAt`) with this
   * `dedupeKey`, or null. Proposals use it so a decided kind comes back only on new evidence.
   */
  latestDecision(dedupeKey: string): Promise<ConfigChange | null>;
  /**
   * The project's decided changes (accepted or rejected), in no set order: at most `max`, in one
   * capped read (AI-137). `complete` is false when more exist, so a caller must not take a
   * missing key as undecided.
   */
  listDecided(projectId: string, max: number): Promise<Listing<ConfigChange>>;
  /**
   * Pending → accepted or rejected, recording who and when; `appliedAt` stays null.
   * `conflict` when the change isn't pending, `not_found` when unknown.
   */
  decide(id: string, decision: ConfigChangeDecision, by: string, at: string): Promise<ConfigChange>;
}
