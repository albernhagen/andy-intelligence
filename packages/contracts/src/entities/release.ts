import { z } from "zod";
import { Id } from "./common";
import { DeploymentEnvironment } from "./deployment";
import { ReleaseNote } from "./release-notes";

/**
 * A release (AI-169: M6.8, ADR-0114 "Release notes"): the PRs merged between the previous
 * succeeded deployment's commit and this deployment's, each with the note stored when it merged
 * (AI-159, ADR-0121). Computed on read, never stored; no model call. Note and title text is
 * untrusted PR content: plain text only.
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

/** One "What changed" line. `noNote`: no stored note, so the line is the commit title. */
export const ReleaseLine = z.object({
  prNumber: z.number().int().positive().nullable(),
  prUrl: z.url().nullable(),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  text: z.string(),
  noNote: z.boolean(),
});
export type ReleaseLine = z.infer<typeof ReleaseLine>;

/** A release's lines under one milestone epic (null: the PR's ticket has none, or no ticket). */
export const ReleaseGroup = z.object({
  epicKey: z.string().nullable(),
  epicTitle: z.string().nullable(),
  lines: z.array(ReleaseLine),
});
export type ReleaseGroup = z.infer<typeof ReleaseGroup>;

export const DeploymentRelease = z.object({
  projectId: Id,
  environment: DeploymentEnvironment,
  deploymentId: z.string().min(1),
  gitSha: z.string().regex(/^[0-9a-f]{40}$/),
  /** The previous succeeded deployment to the same environment; null when there is none. */
  previous: z.object({ deploymentId: z.string().min(1), gitSha: z.string() }).nullable(),
  status: DeploymentReleaseStatus,
  /** Why the range could not be read; set only for `unavailable`. */
  reason: z.string().nullable(),
  /** Oldest merge first. */
  entries: z.array(ReleaseEntry),
  /** The entries' lines grouped by milestone epic, groups in order of their first merge. */
  groups: z.array(ReleaseGroup),
  /** The commit cap was reached: the newest commits are missing. */
  truncated: z.boolean(),
});
export type DeploymentRelease = z.infer<typeof DeploymentRelease>;
