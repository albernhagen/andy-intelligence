import type { ConfigChange, ConfigChangeStatus } from "../entities";
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

export interface ConfigChangeFilter {
  projectId?: string;
  status?: ConfigChangeStatus;
  /** At most this many, newest first. */
  limit: number;
}

export interface ConfigChangeStore {
  /**
   * Stores a `pending` change, atomically refusing a duplicate: when a pending change with the
   * same `dedupeKey` exists, nothing is written and that change comes back (`created: false`).
   */
  createPending(change: ConfigChange): Promise<{ created: boolean; change: ConfigChange }>;
  get(id: string): Promise<ConfigChange | null>;
  list(filter: ConfigChangeFilter): Promise<ConfigChange[]>;
  /**
   * Pending → rejected, recording who and when. `conflict` when the change isn't pending,
   * `not_found` when unknown.
   */
  reject(id: string, by: string, at: string): Promise<ConfigChange>;
}
