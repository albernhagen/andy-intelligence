import { z } from "zod";
import { Id } from "./common";
import { Deployment, DEPLOYMENT_LIMITS, DeploymentEnvironment } from "./deployment";
import { DeploymentReleaseStatus, ReleaseEntry, ReleasePrevious } from "./release-entry";

/**
 * A release (AI-169: M6.8, ADR-0114 "Release notes"): the PRs merged between the previous
 * succeeded deployment's commit and this deployment's, each with the note stored when it merged
 * (AI-159, ADR-0121). Computed once and kept on the deployment (`StoredRelease`, AI-183: M6.9);
 * no model call. Note and title text is untrusted PR content: plain text only.
 */

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
  previous: ReleasePrevious.nullable(),
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

// ── Releases listing (AI-183: M6.9) ─────────────────────────────────────────

/** The environments a releases listing reads: previews ship per PR, so they have no release. */
export const ReleaseEnvironment = DeploymentEnvironment.extract(["dev", "prod"]);
export type ReleaseEnvironment = z.infer<typeof ReleaseEnvironment>;

/** A ticket a release shipped: named by a shipped PR's stored note. */
export const ReleaseTicket = z.object({
  key: z.string(),
  /** Null when the ticket is no longer in the project. */
  title: z.string().nullable(),
  /** Its milestone epic, as the tickets are now; null when none. */
  epicKey: z.string().nullable(),
});
export type ReleaseTicket = z.infer<typeof ReleaseTicket>;

/** A deployment as a listing shows it: every field but its cached release (in `release`). */
export const ReleaseDeployment = z.object(Deployment.shape).omit({ release: true });
export type ReleaseDeployment = z.infer<typeof ReleaseDeployment>;

export const ReleaseListItem = z.object({
  deployment: ReleaseDeployment,
  /** In order of their first shipped PR. */
  tickets: z.array(ReleaseTicket),
  release: DeploymentRelease,
});
export type ReleaseListItem = z.infer<typeof ReleaseListItem>;

/** One environment's deployments, newest first, each with its release. */
export const ReleaseListing = z.object({
  projectId: Id,
  environment: ReleaseEnvironment,
  items: z.array(ReleaseListItem).max(DEPLOYMENT_LIMITS.maxPage),
});
export type ReleaseListing = z.infer<typeof ReleaseListing>;
