import { z } from "zod";
import { Timestamp } from "./common";

/**
 * Sync runs (AI-72, ADR-0083): when the default branch moves, each open agent PR merges it,
 * reruns the project's checks and pushes. A sync run is a Run with step `sync`; its PR's build
 * run keeps the PR's sync state.
 */

/** How a sync run ended. The last two stop syncs for the PR until its head changes. */
export const SyncOutcome = z.enum([
  "synced",
  "already_current",
  "conflict_unresolved",
  "checks_failed",
]);
export type SyncOutcome = z.infer<typeof SyncOutcome>;

/** Outcomes that flag the ticket Needs-you and stop syncs until the PR head changes. */
export const SYNC_STOP_OUTCOMES: readonly SyncOutcome[] = ["conflict_unresolved", "checks_failed"];

/** Why a wanted sync run didn't start (ADR-0083). */
export const SyncWaitReason = z.enum([
  "paused",
  "global_cap",
  "quota_reserve",
  /** Quota at warn and an agent task in flight somewhere (AI-92). */
  "quota_warn",
  "daily_cap",
  /** Another run of the ticket is in flight. */
  "ticket_busy",
  /** Builds are off for the project, or no executor is connected. */
  "builds_off",
  /** More open agent PRs than one tick checks; it comes first on the next tick. */
  "pr_cap",
]);
export type SyncWaitReason = z.infer<typeof SyncWaitReason>;

/** Caps on agent text and lists in a sync result (ADR-0028). */
export const SYNC_LIMITS = { files: 50, path: 300, reason: 2000, summary: 4000 } as const;
const Path = z.string().min(1).max(SYNC_LIMITS.path);
const Sha = z.string().regex(/^[0-9a-f]{40}$/);

/** One check the sync agent ran: the shape of a build's `BuildCheck` (kept here: no import cycle). */
const SyncCheck = z.strictObject({
  command: z.string().min(1).max(200),
  passed: z.boolean(),
  output: z.string().max(2000),
});

/**
 * What the sync agent returns. Untrusted agent output, every field capped (ADR-0028);
 * `platform/procedures/sync.schema.json` is the agent's copy, this is the check.
 */
export const SyncOutput = z.strictObject({
  outcome: z.enum(["synced", "conflict_unresolved", "checks_failed"]),
  summary: z.string().min(1).max(SYNC_LIMITS.summary),
  /** Files that conflicted (resolved or not). */
  conflictFiles: z.array(Path).max(SYNC_LIMITS.files),
  /** Why it stopped, for Andy; empty when synced. */
  reason: z.string().max(SYNC_LIMITS.reason),
  verification: z.array(SyncCheck).max(10),
});
export type SyncOutput = z.infer<typeof SyncOutput>;

/** On a sync run: the PR it syncs and how it ended. */
export const SyncRunRecord = z.object({
  /** The build run that opened the PR. */
  buildRunId: z.string().min(1).max(64),
  pullRequest: z.url(),
  number: z.number().int().positive(),
  /** The PR's head branch (`agent/<KEY>/<buildRunId>`): the only branch the run may push. */
  branch: z.string().min(1).max(200),
  /** The PR head when the run started. */
  headSha: Sha,
  outcome: SyncOutcome.nullable(),
  /** The merge commit pushed (synced only). */
  pushedSha: Sha.nullable(),
  conflictFiles: z.array(Path).max(SYNC_LIMITS.files),
  reason: z.string().max(SYNC_LIMITS.reason).nullable(),
});
export type SyncRunRecord = z.infer<typeof SyncRunRecord>;

/** On a PR's build run: whether a sync is wanted, why it waits, and whether syncs are stopped. */
export const PrSyncState = z.object({
  /** Since when a sync is wanted and not started (queued); null when none is. */
  pendingSince: Timestamp.nullable(),
  /** Why the wanted sync hasn't started; null when it isn't waiting. */
  waiting: SyncWaitReason.nullable(),
  /** No sync starts while the PR head is this commit (after conflict_unresolved or checks_failed). */
  stoppedHeadSha: Sha.nullable(),
  stoppedReason: z.string().max(SYNC_LIMITS.reason).nullable(),
  /** The UTC day (YYYY-MM-DD) the daily cap last flagged the ticket, so it flags once a day. */
  capFlaggedDay: z.string().max(10).nullable(),
  /** When a tick last checked the PR on the host; orders the PRs once there are more than a tick checks. */
  checkedAt: Timestamp.nullable().default(null),
});
export type PrSyncState = z.infer<typeof PrSyncState>;

export const PR_SYNC_EMPTY: PrSyncState = {
  pendingSince: null,
  waiting: null,
  stoppedHeadSha: null,
  stoppedReason: null,
  capFlaggedDay: null,
  checkedAt: null,
};

/** Spread into `Run`. Defaults keep older documents readable (no schema version bump). */
export const runSyncFields = {
  /** A sync run's PR and outcome; null for other steps. */
  syncRun: SyncRunRecord.nullable().default(null),
  /** A build run's PR sync state; null until main first moves under its PR. */
  prSync: PrSyncState.nullable().default(null),
};
