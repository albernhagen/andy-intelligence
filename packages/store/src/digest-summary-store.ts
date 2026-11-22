import type { Firestore, Transaction } from "@google-cloud/firestore";
import {
  DigestSummary,
  type DigestSummaryClaim,
  type DigestSummaryDispatch,
  type DigestSummaryFailure,
  type DigestSummaryOutput,
  type DigestSummaryPeriod,
  type DigestSummaryRetry,
  type DigestSummaryStore,
  claimedDigestSummary,
  completedDigestSummary,
  digestSummaryRetryRefusal,
  dispatchedDigestSummary,
  failedDigestSummary,
  retriedDigestSummary,
} from "@andy/contracts";
import { collections, typedCollection } from "./index";

/**
 * DigestSummaryStore on Firestore (AI-323, ADR-0137): `projects/{projectId}/digestSummaries/
 * {YYYY-MM-DD}`, and a per-UTC-day count of writes started at `digestSummaryDays/{YYYY-MM-DD}`.
 * Every change runs in a transaction, so two readers racing on a day claim it once and the day's
 * cap holds across instances. Point reads only: no index, no rules change (server-only data).
 */
export class FirestoreDigestSummaryStore implements DigestSummaryStore {
  constructor(private readonly db: Firestore) {}

  private summaries(projectId: string) {
    return typedCollection(this.db, collections.digestSummaries.path(projectId), DigestSummary);
  }

  private day(now: string) {
    const utcDay = new Date(now).toISOString().slice(0, 10);
    return this.db.collection(collections.digestSummaryDays.path()).doc(utcDay);
  }

  async get(projectId: string, id: string): Promise<DigestSummary | null> {
    return (await this.summaries(projectId).doc(id).get()).data() ?? null;
  }

  async claim(
    projectId: string,
    period: DigestSummaryPeriod,
    perDay: number,
    now: string,
  ): Promise<DigestSummaryClaim> {
    const fresh = claimedDigestSummary(projectId, period, now);
    const ref = this.summaries(projectId).doc(fresh.id);
    return this.db.runTransaction(async (tx): Promise<DigestSummaryClaim> => {
      const existing = (await tx.get(ref)).data();
      if (existing) return { outcome: "exists", summary: existing };
      if (!(await this.takeStart(tx, now, perDay))) return { outcome: "capped", summary: null };
      tx.create(ref, fresh);
      return { outcome: "claimed", summary: fresh };
    });
  }

  async retry(
    projectId: string,
    id: string,
    perDay: number,
    now: string,
  ): Promise<DigestSummaryRetry> {
    const ref = this.summaries(projectId).doc(id);
    return this.db.runTransaction(async (tx): Promise<DigestSummaryRetry> => {
      const s = (await tx.get(ref)).data();
      if (!s) return { outcome: "missing", summary: null };
      const refusal = digestSummaryRetryRefusal(s);
      if (refusal) return { outcome: refusal, summary: s };
      const next = retriedDigestSummary(s, now);
      if (!(await this.takeStart(tx, now, perDay))) return { outcome: "capped", summary: s };
      tx.set(ref, next);
      return { outcome: "retried", summary: next };
    });
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

  /** Counts one write started on `now`'s UTC day, unless the day is at `perDay`. Reads first. */
  private async takeStart(tx: Transaction, now: string, perDay: number): Promise<boolean> {
    const ref = this.day(now);
    const count = Number((await tx.get(ref)).get("count") ?? 0);
    if (count >= perDay) return false;
    tx.set(ref, { count: count + 1 });
    return true;
  }

  private change(
    projectId: string,
    id: string,
    next: (s: DigestSummary) => DigestSummary | null,
  ): Promise<DigestSummary | null> {
    const ref = this.summaries(projectId).doc(id);
    return this.db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data();
      const changed = s ? next(s) : null;
      if (changed) tx.set(ref, changed);
      return changed;
    });
  }
}
