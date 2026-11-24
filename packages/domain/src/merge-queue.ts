import {
  MERGE_QUEUE_MAX_ENTRIES,
  WorkTrackerError,
  type CodeHost,
  type GateReason,
  type MergeQueueEntry,
  type MergeQueueKind,
  type MergeQueueState,
  type MergeQueueStore,
  type MergeWaitReason,
} from "@andy/contracts";
import type { MergeVerdict } from "./merge-verdict";

/**
 * Merge queue per repo (AI-110, ADR-0150). Every control-plane merge into a repo's default branch
 * (the gate's and MCP `merge_pr`'s) goes through it, so two merges can't be judged on the same
 * default branch:
 *
 * - **Order**: oldest clean first. A PR joins when it is clean or clean but behind, and keeps its
 *   place. The queue judges entries in order and stops at the first one that is in flight (clean,
 *   or waiting on its checks); an entry parked on a sync it asked for is passed over until an
 *   event about it arrives, so a sync that never comes can't block the repo.
 * - **Lease**: judging and merging happens under a lease on the repo's queue record, taken by
 *   compare-and-set, so it holds across API instances, and renewed just before each merge call
 *   (a lost lease aborts the merge). A lease expires (`MERGE_QUEUE_LEASE_MS`), so a crashed
 *   holder can't block the repo; the next one takes it over.
 * - **Sync, wait, merge**: a head behind the default branch gets one sync round per head (the
 *   existing paths: sync tasks for agent PRs, the re-sync workflow for the rest); the queue waits
 *   for the new head's checks and reviews, re-judges it, re-reads the base tip and merges pinned
 *   to the judged head. A head already up to date and clean merges with no extra round.
 * - **Drop**: failed checks, a cap, or a PR that stops being clean leaves the queue; failed checks
 *   and caps flag its ticket (Andy's Needs-you inbox), a PR no longer clean gets a ticket comment.
 *
 * The queue moves on events (webhooks, `merge_pr` calls): no polling job. The hold cap is checked
 * on the next event in its repo.
 */

/** Sync rounds per PR while queued (ADR-0028); one more drops it with a Needs-you note. */
export const MAX_SYNCS_PER_PR = 3;
/** How long a PR may be judged without merging (ADR-0028) before it is dropped. */
export const MAX_HEAD_HOLD_MS = 60 * 60_000;
/** A lease covers one judge-and-merge; a holder gone longer than this is taken over. */
export const MERGE_QUEUE_LEASE_MS = 90_000;
/** Heads one advance handles at most (each costs host reads, ADR-0028). */
export const MAX_STEPS_PER_ADVANCE = 5;
/** Compare-and-set retries per write before giving up (logged, the next event retries). */
const MAX_WRITE_RETRIES = 5;

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "merge-queue", ...fields }));
}

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 2000);

/** What an entry point found for a queued PR's current head. */
export type QueueJudgement =
  /** Closed, merged, or no longer one of ours. */
  | { state: "gone"; detail: string }
  /** Clean and contains `baseSha`, the default branch's tip it was judged on. */
  | { state: "merge"; headSha: string; baseRef: string; baseSha: string }
  /** Clean except that it lacks the default branch's tip. */
  | { state: "behind"; headSha: string }
  /** Checks, reviews or a sync still running, or a fact not readable yet. */
  | { state: "pending"; headSha: string; reasons: string[] }
  /** A check failed. */
  | { state: "failed"; headSha: string; reasons: string[] }
  /** Not clean for another reason (mode, label, kept path, ticket stage, a veto). */
  | { state: "ineligible"; headSha: string; reasons: string[] };

export type QueueMergeResult =
  { merged: true; sha: string | null } | { merged: false; error: string };

/** One entry point's side of the queue: the gate's or `merge_pr`'s. */
export interface QueueJudge {
  judge(repo: string, entry: MergeQueueEntry): Promise<QueueJudgement>;
  /** Merges pinned to `headSha` and records it; a host refusal is returned, not thrown. */
  merge(repo: string, entry: MergeQueueEntry, headSha: string): Promise<QueueMergeResult>;
  /** Asks the existing path to merge the default branch into the PR. */
  requestSync(repo: string, entry: MergeQueueEntry, headSha: string): Promise<void>;
  /**
   * Records why the queue dropped the PR on its ticket; `flag` also puts it in Andy's Needs-you
   * inbox (failed checks, caps), otherwise a comment only (no longer clean).
   */
  needsYou(repo: string, entry: MergeQueueEntry, reason: string, flag: boolean): Promise<void>;
}

export interface QueueOffer {
  projectId: string;
  number: number;
  kind: MergeQueueKind;
  /** Who asked: `system` for the gate, the caller for `merge_pr`. */
  actor: string;
  headSha: string;
}

/** What happened to one PR in an advance. */
export type QueueOutcome =
  | { number: number; outcome: "merged"; sha: string | null; headSha: string }
  | { number: number; outcome: "dropped"; reason: string }
  | { number: number; outcome: "waiting"; reason: string };

export type OfferResult =
  | { result: "merged"; sha: string | null; headSha: string }
  | { result: "dropped"; reason: string }
  | { result: "queued"; position: number; reason: string };

/** How a judgement is reached from a verdict: shared by the gate and `merge_pr`. */
const PENDING_VERDICT: readonly MergeWaitReason[] = [
  "up_to_date_unknown",
  "labels_unknown",
  "review_findings_unknown",
];
const PENDING_GATE: readonly GateReason[] = ["checks_pending", "checks_incomplete", "sync_pending"];

/**
 * The queue's reading of a merge verdict and the gate's reasons: `merge`, `behind` (clean but
 * lacks the default branch), `pending`, `failed` (a check failed) or `ineligible`. A reason it
 * doesn't know is `ineligible`: the queue never merges past it.
 */
export function queueStateOf(
  verdict: Pick<MergeVerdict, "verdict" | "reasons">,
  gateReasons: readonly string[],
): "merge" | "behind" | "pending" | "failed" | "ineligible" {
  if (verdict.verdict === "merge") return "merge";
  let failed = false;
  let pending = false;
  let behind = false;
  for (const reason of verdict.reasons) {
    if (reason === "behind_default_branch") {
      behind = true;
      continue;
    }
    if (PENDING_VERDICT.includes(reason)) {
      pending = true;
      continue;
    }
    if (reason !== "gate_not_clean") return "ineligible";
    // Not clean with no reason given: never read as clean.
    if (gateReasons.length === 0) return "ineligible";
    for (const g of gateReasons) {
      if (g === "checks_failed") failed = true;
      else if ((PENDING_GATE as readonly string[]).includes(g)) pending = true;
      else return "ineligible";
    }
  }
  if (failed) return "failed";
  if (pending) return "pending";
  return behind ? "behind" : "ineligible";
}

/** After a step: `rescan` from the first entry (merged, dropped, base moved), `skip` to the next (parked on its sync), or `stop`. */
type Then = "rescan" | "skip" | "stop";
type Step =
  | { kind: "remove"; outcome: QueueOutcome; then: Then }
  | { kind: "keep"; outcome: QueueOutcome; patch: Partial<MergeQueueEntry>; then: Then };

/** Parked: waiting on a sync it asked for, with no newer head seen. */
const parked = (e: MergeQueueEntry) =>
  e.syncRequestedSha !== null && e.syncRequestedSha === e.headSha;

export class MergeQueue {
  private readonly judges = new Map<MergeQueueKind, QueueJudge>();

  constructor(
    private readonly store: MergeQueueStore,
    private readonly host: Pick<CodeHost, "branchSha">,
    private readonly now: () => Date = () => new Date(),
    /** Test seam: a new lease holder ID per advance. */
    // Web Crypto, not node:crypto: @andy/domain is also bundled for the browser (UI e2e).
    private readonly newHolder: () => string = () => globalThis.crypto.randomUUID(),
  ) {}

  /** Each entry point registers its judge once, at startup. */
  register(kind: MergeQueueKind, judge: QueueJudge): void {
    this.judges.set(kind, judge);
  }

  /** The repo's queue, for reads and tests. */
  state(repo: string): Promise<MergeQueueState> {
    return this.store.get(repo);
  }

  /**
   * Queues a clean (or clean but behind) PR, or keeps its place, then advances the repo's queue.
   * Resolves with what happened to this PR.
   */
  async offer(repo: string, offer: QueueOffer): Promise<OfferResult> {
    const key = repo.toLowerCase();
    const fields = { repo: key, pr: offer.number, kind: offer.kind };
    const added = await this.write(key, (q) => {
      const at = q.entries.findIndex((e) => e.number === offer.number);
      if (at >= 0) {
        const entries = [...q.entries];
        if (entries[at]!.headSha === offer.headSha) return { next: null, result: "kept" as const };
        entries[at] = { ...entries[at]!, headSha: offer.headSha };
        return { next: { ...q, entries }, result: "kept" as const };
      }
      if (q.entries.length >= MERGE_QUEUE_MAX_ENTRIES)
        return { next: null, result: "full" as const };
      const entry: MergeQueueEntry = {
        projectId: offer.projectId,
        number: offer.number,
        kind: offer.kind,
        enqueuedAt: this.now().toISOString(),
        enqueuedBy: offer.actor,
        headSha: offer.headSha,
        syncs: 0,
        syncRequestedSha: null,
        judgedSince: null,
      };
      return { next: { ...q, entries: [...q.entries, entry] }, result: "added" as const };
    });
    if (added === "full") {
      const reason = `the merge queue of ${key} is full (${MERGE_QUEUE_MAX_ENTRIES} PRs)`;
      log("WARNING", "merge queue drop", { ...fields, reason });
      await this.notify(key, this.entryOf(offer), reason, true);
      return { result: "dropped", reason };
    }
    if (added === "added") log("INFO", "merge queue enqueue", fields);

    const outcomes = await this.advance(key);
    const mine = outcomes.findLast((o) => o.number === offer.number);
    if (mine?.outcome === "merged") {
      return { result: "merged", sha: mine.sha, headSha: mine.headSha };
    }
    if (mine?.outcome === "dropped") return { result: "dropped", reason: mine.reason };
    const q = await this.store.get(key);
    const position = q.entries.findIndex((e) => e.number === offer.number);
    if (position < 0) return { result: "dropped", reason: "left the queue" };
    const reason = mine?.reason ?? "waiting its turn";
    return { result: "queued", position: position + 1, reason };
  }

  /**
   * Advances the queue for a webhook: when the default branch moved, when the event is about a
   * queued PR (its checks, a push, a close), or when a queued PR is past its hold cap (so any
   * event in the repo drops a stuck one). Other events cost one store read and no host reads.
   */
  async advanceFor(repo: string, prNumbers: readonly number[], defaultBranchMoved: boolean) {
    const { entries } = await this.store.get(repo);
    if (entries.length === 0) return [];
    const named = entries.some((e) => prNumbers.includes(e.number));
    if (!defaultBranchMoved && !named && !entries.some((e) => this.stale(e))) return [];
    return this.advance(repo, prNumbers);
  }

  /**
   * Judges queued PRs in order under the lease, and merges, syncs, waits or drops each: after a
   * merge or drop it starts again from the first; an entry parked on its sync is passed over
   * unless `wake` names it or it is past its hold cap; the first entry in flight stops it. At most
   * `MAX_STEPS_PER_ADVANCE` judgements. Another live holder means it returns at once (that holder
   * carries on). Never throws: a failure is logged and the next event retries.
   */
  async advance(repo: string, wake: readonly number[] = []): Promise<QueueOutcome[]> {
    const key = repo.toLowerCase();
    const holder = this.newHolder();
    const outcomes: QueueOutcome[] = [];
    const passed = new Set<number>();
    try {
      for (let i = 0; i < MAX_STEPS_PER_ADVANCE; i++) {
        const entry = await this.takeLease(
          key,
          holder,
          (e) => !passed.has(e.number) && (!parked(e) || wake.includes(e.number) || this.stale(e)),
        );
        if (!entry) break;
        let step: Step;
        try {
          step = await this.step(key, holder, entry);
        } catch (err) {
          log("ERROR", "merge queue step failed", {
            repo: key,
            pr: entry.number,
            error: errorText(err),
          });
          step = {
            kind: "keep",
            patch: {},
            then: "stop",
            outcome: { number: entry.number, outcome: "waiting", reason: "error" },
          };
        }
        outcomes.push(step.outcome);
        await this.finish(key, holder, entry.number, step);
        if (step.then === "stop") break;
        if (step.then === "skip") passed.add(entry.number);
        else passed.clear();
      }
    } catch (err) {
      log("ERROR", "merge queue advance failed", { repo: key, error: errorText(err) });
    }
    return outcomes;
  }

  private stale(e: MergeQueueEntry): boolean {
    return (
      e.judgedSince !== null && this.now().getTime() - Date.parse(e.judgedSince) > MAX_HEAD_HOLD_MS
    );
  }

  /** The first eligible entry with the lease now ours, or null (none, or another live holder). */
  private async takeLease(
    repo: string,
    holder: string,
    eligible: (e: MergeQueueEntry) => boolean,
  ): Promise<MergeQueueEntry | null> {
    const now = this.now();
    type Taken =
      { busy: string } | { entry: MergeQueueEntry; takenOver: MergeQueueState["lease"] } | null;
    const taken = await this.write<Taken>(repo, (q) => {
      const at = q.entries.findIndex(eligible);
      if (at < 0) return { next: null, result: null };
      const lease = q.lease;
      const live = lease && lease.holder !== holder && Date.parse(lease.until) > now.getTime();
      if (live) return { next: null, result: { busy: lease.holder } };
      const found = q.entries[at]!;
      const entry = { ...found, judgedSince: found.judgedSince ?? now.toISOString() };
      const entries = [...q.entries];
      entries[at] = entry;
      const until = new Date(now.getTime() + MERGE_QUEUE_LEASE_MS).toISOString();
      return {
        next: { ...q, entries, lease: { holder, until } },
        result: { entry, takenOver: lease && lease.holder !== holder ? lease : null },
      };
    });
    if (!taken) return null;
    if ("busy" in taken) {
      log("INFO", "merge queue busy", { repo, holder: taken.busy });
      return null;
    }
    if (taken.takenOver) {
      log("WARNING", "merge queue lease takeover", {
        repo,
        pr: taken.entry.number,
        from: taken.takenOver.holder,
        expired: taken.takenOver.until,
      });
    }
    return taken.entry;
  }

  /**
   * Extends our lease just before a merge call; false when another holder took it over (our step
   * ran past the lease), so the merge is not made.
   */
  private async renewLease(repo: string, holder: string): Promise<boolean> {
    const until = new Date(this.now().getTime() + MERGE_QUEUE_LEASE_MS).toISOString();
    return this.write(repo, (q) => {
      if (q.lease?.holder !== holder) return { next: null, result: false };
      return { next: { ...q, lease: { holder, until } }, result: true };
    });
  }

  /** Applies a step to the entry (if still queued) and releases our lease (if still ours). */
  private async finish(repo: string, holder: string, number: number, step: Step): Promise<void> {
    await this.write(repo, (q) => {
      const at = q.entries.findIndex((e) => e.number === number);
      const entries = [...q.entries];
      if (at >= 0) {
        if (step.kind === "remove") entries.splice(at, 1);
        else entries[at] = { ...entries[at]!, ...step.patch };
      }
      const lease = q.lease?.holder === holder ? null : q.lease;
      return { next: { ...q, entries, lease }, result: undefined };
    });
  }

  private async step(repo: string, holder: string, head: MergeQueueEntry): Promise<Step> {
    const fields = { repo, pr: head.number, kind: head.kind };
    const wait = (
      reason: string,
      patch: Partial<MergeQueueEntry> = {},
      then: Then = "stop",
    ): Step => {
      log("INFO", "merge queue wait", { ...fields, reason });
      return {
        kind: "keep",
        patch,
        then,
        outcome: { number: head.number, outcome: "waiting", reason },
      };
    };
    /** `note`: none (closed), a ticket comment (no longer clean), or a Needs-you flag. */
    const drop = async (reason: string, note: "none" | "comment" | "flag"): Promise<Step> => {
      log(note === "flag" ? "WARNING" : "INFO", "merge queue drop", { ...fields, reason });
      if (note !== "none") await this.notify(repo, head, reason, note === "flag");
      return {
        kind: "remove",
        then: "rescan",
        outcome: { number: head.number, outcome: "dropped", reason },
      };
    };

    const judge = this.judges.get(head.kind);
    if (!judge) {
      log("ERROR", "merge queue has no judge", fields);
      return wait("no judge registered");
    }
    if (this.stale(head)) {
      return drop(
        `it was in the merge queue for over ${MAX_HEAD_HOLD_MS / 60_000} minutes without becoming clean on the latest default branch (a sync that never came, or checks that never finished)`,
        "flag",
      );
    }

    const j = await judge.judge(repo, head);
    switch (j.state) {
      case "gone":
        return drop(j.detail, "none");
      case "failed":
        return drop(
          `its checks failed on ${j.headSha.slice(0, 12)}: ${j.reasons.join(", ")}`,
          "flag",
        );
      case "ineligible":
        return drop(`no longer clean: ${j.reasons.join(", ")}`, "comment");
      case "pending":
        return wait(`pending: ${j.reasons.join(", ")}`, { headSha: j.headSha });
      case "behind": {
        // Parked on its sync: the next entry may go first.
        if (head.syncRequestedSha === j.headSha) {
          return wait("waiting for its sync", { headSha: j.headSha }, "skip");
        }
        if (head.syncs >= MAX_SYNCS_PER_PR) {
          return drop(
            `it still lacks the default branch after ${MAX_SYNCS_PER_PR} syncs in the merge queue`,
            "flag",
          );
        }
        log("INFO", "merge queue sync", { ...fields, headSha: j.headSha, syncs: head.syncs + 1 });
        await judge.requestSync(repo, head, j.headSha);
        return wait(
          "sync requested",
          { headSha: j.headSha, syncs: head.syncs + 1, syncRequestedSha: j.headSha },
          "skip",
        );
      }
      case "merge": {
        // Only control-plane merges hold the lease: a merge by hand may still have moved it.
        const tip = await this.host.branchSha(repo, j.baseRef);
        if (tip !== j.baseSha) {
          log("INFO", "merge queue base moved", { ...fields, judged: j.baseSha, tip });
          return wait("base moved", { headSha: j.headSha }, "rescan");
        }
        if (!(await this.renewLease(repo, holder))) {
          log("WARNING", "merge queue lease lost before merging", fields);
          return wait("lease lost", { headSha: j.headSha });
        }
        const merged = await judge.merge(repo, head, j.headSha);
        if (merged.merged) {
          log("INFO", "merge queue merge", { ...fields, headSha: j.headSha, sha: merged.sha });
          return {
            kind: "remove",
            then: "rescan",
            outcome: {
              number: head.number,
              outcome: "merged",
              sha: merged.sha,
              headSha: j.headSha,
            },
          };
        }
        // A push between judging and merging leaves a new head to judge; else it is Andy's.
        const again = await judge.judge(repo, head);
        if (again.state === "gone") return drop(again.detail, "none");
        if (again.headSha !== j.headSha) return wait("head moved", { headSha: again.headSha });
        // The entry point already recorded the refusal on the ticket.
        return drop(`the merge was refused: ${merged.error}`, "none");
      }
    }
  }

  private entryOf(offer: QueueOffer): MergeQueueEntry {
    return {
      projectId: offer.projectId,
      number: offer.number,
      kind: offer.kind,
      enqueuedAt: this.now().toISOString(),
      enqueuedBy: offer.actor,
      headSha: offer.headSha,
      syncs: 0,
      syncRequestedSha: null,
      judgedSince: null,
    };
  }

  /** Needs-you note through the entry's judge; a failure is logged, never thrown. */
  private async notify(
    repo: string,
    entry: MergeQueueEntry,
    reason: string,
    flag: boolean,
  ): Promise<void> {
    try {
      await this.judges.get(entry.kind)?.needsYou(repo, entry, reason, flag);
    } catch (err) {
      log("ERROR", "merge queue needs-you note failed", {
        repo,
        pr: entry.number,
        error: errorText(err),
      });
    }
  }

  /** Read, change, compare-and-set; retried on a conflicting write. */
  private async write<T>(
    repo: string,
    change: (q: MergeQueueState) => { next: MergeQueueState | null; result: T },
  ): Promise<T> {
    for (let i = 0; i < MAX_WRITE_RETRIES; i++) {
      const q = await this.store.get(repo);
      const { next, result } = change(q);
      if (!next) return result;
      try {
        await this.store.put(next, q.version);
        return result;
      } catch (err) {
        if (err instanceof WorkTrackerError && err.code === "conflict") continue;
        throw err;
      }
    }
    throw new Error(
      `the merge queue of ${repo} kept changing: gave up after ${MAX_WRITE_RETRIES} tries`,
    );
  }
}
