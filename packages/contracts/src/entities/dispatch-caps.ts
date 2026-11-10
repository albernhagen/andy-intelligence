import { z } from "zod";
import { Timestamp } from "./common";

/** Project dispatch settings and the dispatcher's last decision (ADR-0079). */

/** Runs at once per project when Andy hasn't set the dial (ADR-0079). */
export const RUNS_AT_ONCE_DEFAULT = 2;
/** The highest the dial goes (ADR-0079). */
export const RUNS_AT_ONCE_MAX = 4;

const RunsAtOnce = z.number().int().min(1).max(RUNS_AT_ONCE_MAX);

/** Why the dispatcher won't start a run now (ADR-0079). */
export const DispatchIdleReason = z.enum([
  "paused",
  "project_cap",
  "global_cap",
  "prs_waiting_cap",
  "quota_reserve",
]);
export type DispatchIdleReason = z.infer<typeof DispatchIdleReason>;

/** The dispatcher's last decision for a project: an idle reason, or what it found under the caps. */
export const DispatchDecision = z.enum([
  ...DispatchIdleReason.options,
  "started",
  "nothing_ready",
  // Ready tickets wait only because their touches overlap a run in flight (ADR-0080).
  "touches_overlap",
]);
export type DispatchDecision = z.infer<typeof DispatchDecision>;

export const LastDispatch = z.object({
  decision: DispatchDecision,
  /** When the dispatcher first reached this decision. */
  at: Timestamp,
});
export type LastDispatch = z.infer<typeof LastDispatch>;

/** Spread into `Project`; the defaults cover documents older than the fields. */
export const projectDispatchFields = {
  /** Runs in flight the project may have, of any step (Andy's dial, ADR-0079). */
  runsAtOnce: RunsAtOnce.default(RUNS_AT_ONCE_DEFAULT),
  /** The dispatchers start nothing in this project; runs in flight finish (ADR-0079). */
  paused: z.boolean().default(false),
  /** Written only by the build dispatcher; null until its first decision. */
  lastDispatch: LastDispatch.nullable().default(null),
};

/** Spread into `ProjectPatch`: no defaults, so a patch of one switch can't reset the others. */
export const projectDispatchPatch = {
  runsAtOnce: RunsAtOnce.optional(),
  paused: z.boolean().optional(),
  lastDispatch: LastDispatch.nullable().optional(),
};
