import type { MergeQueueState, MergeQueueStore } from "@andy/contracts";

/**
 * Merge holds (AI-382, ADR-0154): repos whose merge queue is held because a required check failed
 * on the default branch's head. Read from the queue records for the digest's exception and MCP
 * `status`; nothing is stored here.
 */

/** Repos read per call (ADR-0028): one store read each. */
export const MAX_HOLD_REPOS = 20;

export interface MergeHold {
  repo: string;
  /** When the queue first held for it. */
  since: string;
  /** The failing required checks on the default branch's head. */
  checks: string[];
  /** PRs waiting in the repo's queue. */
  waiting: number;
  /** The one Needs-you note past the cap was raised. */
  raised: boolean;
}

export class MergeHoldReader {
  constructor(private readonly store: MergeQueueStore) {}

  /**
   * The held repos among `repos` (at most `MAX_HOLD_REPOS` read), in the order given. A repo whose
   * read fails is logged and left out: a hold is shown alongside the digest and `status`, and
   * must never take them down.
   */
  async forRepos(repos: readonly string[]): Promise<MergeHold[]> {
    const queues = await Promise.all(repos.slice(0, MAX_HOLD_REPOS).map((repo) => this.read(repo)));
    return queues.flatMap((q): MergeHold[] =>
      q?.mainRed && q.entries.length > 0
        ? [
            {
              repo: q.repo,
              since: q.mainRed.since,
              checks: q.mainRed.checks,
              waiting: q.entries.length,
              raised: q.mainRed.raisedAt !== null,
            },
          ]
        : [],
    );
  }

  private async read(repo: string): Promise<MergeQueueState | null> {
    try {
      return await this.store.get(repo);
    } catch (err) {
      console.log(
        JSON.stringify({
          severity: "WARNING",
          message: "merge hold read failed",
          component: "merge-holds",
          repo,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
        }),
      );
      return null;
    }
  }
}
