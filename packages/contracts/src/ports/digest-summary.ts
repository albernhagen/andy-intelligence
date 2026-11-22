import type {
  DigestSummary,
  DigestSummaryDispatch,
  DigestSummaryFailure,
  DigestSummaryOutput,
  DigestSummaryPeriod,
} from "../entities/digest-summary";

// ── DigestSummaryStore ───────────────────────────────────────────────────────
// One summary per project per day (AI-323, ADR-0137). Every write is a checked state change, so
// two readers racing on the same day start at most one task, and a stale task can't overwrite.

/**
 * `claimed`: the day had no summary; it is now `writing` with attempt 1. `exists`: it already
 * has one (any status), returned unchanged. `capped`: the day's write cap across all projects
 * is used up; nothing stored.
 */
export type DigestSummaryClaim =
  | { outcome: "claimed"; summary: DigestSummary }
  | { outcome: "exists"; summary: DigestSummary }
  | { outcome: "capped"; summary: null };

/**
 * `retried`: a `failed` summary is `writing` again with one more attempt. `not_failed`: it is
 * `writing` or `ready`. `attempts_used`: it already had its last attempt. `capped`: the day's
 * write cap across all projects is used up. `missing`: no summary for that day.
 */
export type DigestSummaryRetry =
  | { outcome: "retried"; summary: DigestSummary }
  | { outcome: "not_failed" | "attempts_used" | "capped"; summary: DigestSummary }
  | { outcome: "missing"; summary: null };

export interface DigestSummaryStore {
  get(projectId: string, id: string): Promise<DigestSummary | null>;
  /**
   * Creates the day's summary as `writing` unless one exists. Counts against `perDay` writes
   * started on `now`'s UTC day across all projects; refused as `capped` past it.
   */
  claim(
    projectId: string,
    period: DigestSummaryPeriod,
    perDay: number,
    now: string,
  ): Promise<DigestSummaryClaim>;
  /** One retry by hand after a failure, under the same per-day cap as `claim`. */
  retry(projectId: string, id: string, perDay: number, now: string): Promise<DigestSummaryRetry>;
  /** Records the task on a `writing` summary with no task yet; null otherwise. */
  dispatched(
    projectId: string,
    id: string,
    dispatch: DigestSummaryDispatch,
    now: string,
  ): Promise<DigestSummary | null>;
  /** `writing` → `ready`, only for the task recorded on it; null otherwise. */
  complete(
    projectId: string,
    id: string,
    runId: string,
    output: DigestSummaryOutput,
    now: string,
  ): Promise<DigestSummary | null>;
  /**
   * `writing` → `failed`. With a `runId`, only for that task; without one, only while no task is
   * recorded (dispatch was refused). Null otherwise.
   */
  fail(
    projectId: string,
    id: string,
    runId: string | null,
    failure: DigestSummaryFailure,
    now: string,
  ): Promise<DigestSummary | null>;
}
