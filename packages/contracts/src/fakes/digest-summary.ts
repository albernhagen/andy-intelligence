import {
  type DigestSummary,
  type DigestSummaryDispatch,
  type DigestSummaryFailure,
  type DigestSummaryOutput,
  type DigestSummaryPeriod,
  claimedDigestSummary,
  completedDigestSummary,
  digestSummaryRetryRefusal,
  dispatchedDigestSummary,
  failedDigestSummary,
  retriedDigestSummary,
} from "../entities/digest-summary";
import type {
  DigestSummaryClaim,
  DigestSummaryRetry,
  DigestSummaryStore,
} from "../ports/digest-summary";

const key = (projectId: string, id: string) => `${projectId}\u0000${id}`;
const utcDay = (now: string) => new Date(now).toISOString().slice(0, 10);

/** In-memory DigestSummaryStore (AI-323): synchronous updates, so atomic within one process. */
export class InMemoryDigestSummaryStore implements DigestSummaryStore {
  private readonly rows = new Map<string, DigestSummary>();
  /** Writes started per UTC day, across projects. */
  private readonly started = new Map<string, number>();

  async get(projectId: string, id: string): Promise<DigestSummary | null> {
    const s = this.rows.get(key(projectId, id));
    return s ? structuredClone(s) : null;
  }

  async claim(
    projectId: string,
    period: DigestSummaryPeriod,
    perDay: number,
    now: string,
  ): Promise<DigestSummaryClaim> {
    const existing = this.rows.get(key(projectId, period.id));
    if (existing) return { outcome: "exists", summary: structuredClone(existing) };
    const fresh = claimedDigestSummary(projectId, period, now);
    if (!this.takeStart(now, perDay)) return { outcome: "capped", summary: null };
    this.rows.set(key(projectId, fresh.id), fresh);
    return { outcome: "claimed", summary: structuredClone(fresh) };
  }

  async retry(
    projectId: string,
    id: string,
    perDay: number,
    now: string,
  ): Promise<DigestSummaryRetry> {
    const s = this.rows.get(key(projectId, id));
    if (!s) return { outcome: "missing", summary: null };
    const refusal = digestSummaryRetryRefusal(s);
    if (refusal) return { outcome: refusal, summary: structuredClone(s) };
    const next = retriedDigestSummary(s, now);
    if (!this.takeStart(now, perDay)) return { outcome: "capped", summary: structuredClone(s) };
    this.rows.set(key(projectId, id), next);
    return { outcome: "retried", summary: structuredClone(next) };
  }

  async dispatched(
    projectId: string,
    id: string,
    dispatch: DigestSummaryDispatch,
    now: string,
  ): Promise<DigestSummary | null> {
    return this.change(projectId, id, (s) => dispatchedDigestSummary(s, dispatch, now));
  }

  async complete(
    projectId: string,
    id: string,
    runId: string,
    output: DigestSummaryOutput,
    now: string,
  ): Promise<DigestSummary | null> {
    return this.change(projectId, id, (s) => completedDigestSummary(s, runId, output, now));
  }

  async fail(
    projectId: string,
    id: string,
    runId: string | null,
    failure: DigestSummaryFailure,
    now: string,
  ): Promise<DigestSummary | null> {
    return this.change(projectId, id, (s) => failedDigestSummary(s, runId, failure, now));
  }

  private takeStart(now: string, perDay: number): boolean {
    const day = utcDay(now);
    const count = this.started.get(day) ?? 0;
    if (count >= perDay) return false;
    this.started.set(day, count + 1);
    return true;
  }

  private change(
    projectId: string,
    id: string,
    next: (s: DigestSummary) => DigestSummary | null,
  ): DigestSummary | null {
    const s = this.rows.get(key(projectId, id));
    const changed = s ? next(s) : null;
    if (!changed) return null;
    this.rows.set(key(projectId, id), changed);
    return structuredClone(changed);
  }
}
