import type { Firestore } from "@google-cloud/firestore";
import {
  REVIEW_VERDICT_LIMITS,
  ReviewVerdict,
  recentFindings,
  verdictKey,
  type RecentFindingsQuery,
  type ReviewFinding,
  type ReviewFindingLog,
} from "@andy/contracts";
import { collections, typedCollection } from "./index";

/**
 * A guard on one project's verdict read (ADR-0028). Writes keep at most `maxPerProject`
 * (REVIEW_VERDICT_LIMITS.perProject) per project, so this is reached only if that cap changes;
 * the read then logs an error rather than hiding it.
 */
export const REVIEW_VERDICT_READ_MAX = 2 * REVIEW_VERDICT_LIMITS.perProject;

/**
 * ReviewFindingLog on Firestore (ADR-0097 PR B): `reviewVerdicts/{project~repo~pull~reviewer}`,
 * one document per reviewer's latest verdict on a PR. Recording replaces the document and
 * deletes the project's oldest verdicts past the cap in one transaction. Queries use one
 * equality filter only: no composite index, no rules change (server-only collection).
 */
export class FirestoreReviewFindingLog implements ReviewFindingLog {
  constructor(private readonly db: Firestore) {}

  private verdicts() {
    return typedCollection(this.db, collections.reviewVerdicts.path(), ReviewVerdict);
  }

  async recordVerdict(verdict: ReviewVerdict, maxPerProject: number): Promise<void> {
    const parsed = ReviewVerdict.parse(verdict);
    const id = verdictKey(parsed);
    await this.db.runTransaction(async (tx) => {
      const existing = (
        await tx.get(
          this.verdicts().where("projectId", "==", parsed.projectId).limit(REVIEW_VERDICT_READ_MAX),
        )
      ).docs;
      const others = existing
        .filter((d) => d.id !== id)
        .sort((a, b) => b.data().recordedAt.localeCompare(a.data().recordedAt));
      tx.set(this.verdicts().doc(id), parsed);
      for (const stale of others.slice(Math.max(0, maxPerProject - 1))) tx.delete(stale.ref);
    });
  }

  async recent(projectId: string, query: RecentFindingsQuery): Promise<ReviewFinding[]> {
    const snap = await this.verdicts()
      .where("projectId", "==", projectId)
      .limit(REVIEW_VERDICT_READ_MAX)
      .get();
    if (snap.size >= REVIEW_VERDICT_READ_MAX) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          message: "review verdict read hit its guard; some verdicts were not read",
          component: "review-finding-log",
          projectId,
          read: snap.size,
        }),
      );
    }
    return recentFindings(
      snap.docs.flatMap((d) => d.data().findings),
      query,
    );
  }
}
