import { z } from "zod";
import { Timestamp } from "./common";

/**
 * Merge queue per repo (AI-110, ADR-0150). Every control-plane merge into a repo's default branch
 * goes through its queue: at most one PR at a time is merged, the next one is synced with the
 * default branch and re-checked first. One record per repo; `version` makes each write a
 * compare-and-set, so the queue holds across API instances.
 */

/** PRs waiting per repo at most (ADR-0028); a PR past it is dropped with a Needs-you note. */
export const MERGE_QUEUE_MAX_ENTRIES = 20;

/** A commit as the code host names it (the PR schema's `headSha`), capped. */
const Sha = z.string().min(1).max(100);

/** Which entry point queued the PR: the gate (build agents' PRs) or MCP `merge_pr`. */
export const MergeQueueKind = z.enum(["gate", "merge_pr"]);
export type MergeQueueKind = z.infer<typeof MergeQueueKind>;

export const MergeQueueEntry = z.object({
  projectId: z.string().min(1).max(100),
  number: z.number().int().positive().max(1_000_000_000),
  kind: MergeQueueKind,
  /** When the PR was first found clean: the queue's order (oldest first). */
  enqueuedAt: Timestamp,
  /** Who asked for the merge: `system` for the gate, the caller for `merge_pr`. */
  enqueuedBy: z
    .string()
    .regex(/^(andy|system|agent:.+|user:.+)$/)
    .max(200),
  /** The head last seen. */
  headSha: Sha,
  /** Syncs asked for while queued (one per head found behind). */
  syncs: z.number().int().nonnegative().max(1000),
  /** The head a sync was last asked for; null: none yet. */
  syncRequestedSha: Sha.nullable(),
  /** When the queue first judged it (the hold cap's start); null until then. */
  judgedSince: Timestamp.nullable(),
});
export type MergeQueueEntry = z.infer<typeof MergeQueueEntry>;

/** Who is judging or merging the head now, and until when (a crashed holder expires). */
export const MergeQueueLease = z.object({
  holder: z.string().min(1).max(200),
  until: Timestamp,
});
export type MergeQueueLease = z.infer<typeof MergeQueueLease>;

/**
 * The queue is held because a required check failed on the default branch's head (AI-382,
 * ADR-0154). Set when the queue first holds an entry for `main_red`, cleared when an entry is
 * judged with main not red (or the queue empties).
 */
export const MainRedHold = z.object({
  /** When the queue first held for it: the start of `MAX_MAIN_RED_HOLD_MS`. */
  since: Timestamp,
  /** The failing required checks, as last read. */
  checks: z.array(z.string().min(1).max(256)).max(20),
  /** When the one Needs-you note past the cap was raised; null: not yet. */
  raisedAt: Timestamp.nullable(),
  /** When a judgement last found it still red: completed checks wake it at most once a minute. */
  checkedAt: Timestamp.nullable().default(null),
});
export type MainRedHold = z.infer<typeof MainRedHold>;

export const MergeQueueState = z.object({
  /** `owner/name`, lower-cased. */
  repo: z.string().min(3).max(200),
  /** In merge order: the first is the head of the queue. */
  entries: z.array(MergeQueueEntry).max(MERGE_QUEUE_MAX_ENTRIES),
  lease: MergeQueueLease.nullable(),
  /** Held for a red default branch (AI-382); null: not held. Absent in records stored before. */
  mainRed: MainRedHold.nullable().default(null),
  /** Bumped by every write; 0 for a repo with no stored queue. */
  version: z.number().int().nonnegative(),
});
export type MergeQueueState = z.infer<typeof MergeQueueState>;

/** The empty queue of a repo nothing is stored for. */
export const emptyMergeQueue = (repo: string): MergeQueueState => ({
  repo: repo.toLowerCase(),
  entries: [],
  lease: null,
  mainRed: null,
  version: 0,
});
