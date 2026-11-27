import type {
  NewReleaseRequest,
  ReleaseRequest,
  ReleaseRequestPatch,
  ReleaseRequestStatus,
} from "../entities/release-request";

// ── ReleaseRequestStore ──────────────────────────────────────────────────────
// Promote and rollback requests per project (AI-199: M6.12, ADR-0160). Storage and the rate cap
// only: who may ask, and what may be released, live in @andy/domain.
// Errors are WorkTrackerError (`not_found`, `conflict`), mapped the same way by the API.

export interface ReleaseRequestStore {
  /**
   * Stores a new request with an id the store assigns, atomically refusing it when the project's
   * previous request was created less than `minGapMs` before this one's `createdAt`: then nothing
   * is written and the answer is `too_soon` with the time a new request may be made.
   */
  create(
    request: NewReleaseRequest,
    minGapMs: number,
  ): Promise<{ created: ReleaseRequest } | { tooSoonUntil: string }>;
  get(requestId: string): Promise<ReleaseRequest | null>;
  /**
   * Changes the request atomically only while its status is one of `from`; `conflict` otherwise
   * (nothing is written), `not_found` if unknown.
   */
  update(
    requestId: string,
    patch: ReleaseRequestPatch,
    from: readonly ReleaseRequestStatus[],
  ): Promise<ReleaseRequest>;
  /**
   * The project's requests, newest `createdAt` first: at most `limit` (default
   * `RELEASE_REQUEST_LIMITS.defaultPage`), never more than `RELEASE_REQUEST_LIMITS.maxPage`.
   */
  list(projectId: string, limit?: number): Promise<ReleaseRequest[]>;
}
