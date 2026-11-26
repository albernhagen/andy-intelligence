import { z } from "zod";
import { Timestamp } from "./common";
import { ReleaseNote } from "./release-notes";

/**
 * The parts of a release (AI-169: M6.8) that `Deployment` stores as its cached release (AI-183:
 * M6.9). Kept apart from `release.ts`, which imports `deployment.ts`, so the two never import
 * each other.
 */

/**
 * - `listed`: the commits between the two deployments are listed.
 * - `first`: no earlier succeeded deployment to this environment, so there is nothing to compare.
 * - `same_commit`: the previous succeeded deployment shipped the same commit (a redeploy).
 * - `not_ahead`: this commit is behind or off the previous one (a rollback): nothing new ships.
 * - `unavailable`: the range could not be read; `reason` says why.
 */
export const DeploymentReleaseStatus = z.enum([
  "listed",
  "first",
  "same_commit",
  "not_ahead",
  "unavailable",
]);
export type DeploymentReleaseStatus = z.infer<typeof DeploymentReleaseStatus>;

/** One commit in the release: a PR's squash merge (with its stored note, if any) or a direct push. */
export const ReleaseEntry = z.object({
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  /** The commit message's first line; the PR title for a squash merge. */
  commitTitle: z.string().max(256),
  /** From the squash merge's `(#<n>)` suffix; null for a commit that names no PR. */
  prNumber: z.number().int().positive().nullable(),
  /** The note stored when the PR merged; null when there is none (or no PR). */
  note: ReleaseNote.nullable(),
});
export type ReleaseEntry = z.infer<typeof ReleaseEntry>;

/** The previous succeeded deployment to the same environment. */
export const ReleasePrevious = z.object({
  deploymentId: z.string().min(1),
  gitSha: z.string(),
});
export type ReleasePrevious = z.infer<typeof ReleasePrevious>;

/**
 * A release computed once and kept on its deployment (AI-183: M6.9), so a listing never compares
 * the same two commits twice. Only answers that can't change are kept: never `unavailable`.
 * Epic grouping is not kept; it is worked out on read from the tickets as they are then.
 */
export const StoredRelease = z.object({
  status: DeploymentReleaseStatus.exclude(["unavailable"]),
  previous: ReleasePrevious.nullable(),
  /** Oldest merge first; at most the code host's commit cap (`RANGE_COMMITS_MAX`, 100). */
  entries: z.array(ReleaseEntry).max(100),
  truncated: z.boolean(),
  computedAt: Timestamp,
});
export type StoredRelease = z.infer<typeof StoredRelease>;
