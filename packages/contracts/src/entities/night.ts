import { z } from "zod";
import { Id, Timestamp } from "./common";

/**
 * Overnight runs (ADR-0049): Andy launches an epic in the evening with a night budget and a
 * stop time. A NightLaunch is one such launch. Nothing dispatches from it yet (M4.18 onwards).
 */

/** Caps on one launch (ADR-0028). A budget above these is a launch problem, not a clamp. */
export const NIGHT_LIMITS = {
  /** Agent tasks one launch may start. */
  maxRuns: 100,
  /** Input plus output tokens across the launch's agent tasks. */
  maxTokens: 50_000_000,
  /** API-equivalent dollars across the launch's agent tasks. */
  maxUsd: 500,
  /** The stop time is at most this many hours after the launch. */
  maxHours: 16,
  /** Stories one launch covers. */
  maxStories: 50,
} as const;

/** `planned`: saved, not started. `stopping`: no new agent tasks, in-flight ones finish. */
export const NightLaunchStatus = z.enum(["planned", "running", "stopping", "ended"]);
export type NightLaunchStatus = z.infer<typeof NightLaunchStatus>;

/** A launch in these blocks another launch in the same project. */
export const ACTIVE_NIGHT_STATUSES: readonly NightLaunchStatus[] = ["running", "stopping"];

/**
 * Why a launch ended. `done`: every story finished. `stopped`: Andy stopped it. `stop_time`: the
 * stop time passed. `max_runs`, `max_tokens`, `max_usd`: that budget field was reached.
 */
export const NightEndReason = z.enum([
  "done",
  "stopped",
  "stop_time",
  "max_runs",
  "max_tokens",
  "max_usd",
]);
export type NightEndReason = z.infer<typeof NightEndReason>;

/** A stored, checked budget: every field positive and within `NIGHT_LIMITS`. */
export const NightBudget = z.strictObject({
  maxRuns: z.number().int().positive().max(NIGHT_LIMITS.maxRuns),
  maxTokens: z.number().int().positive().max(NIGHT_LIMITS.maxTokens),
  maxUsd: z.number().positive().max(NIGHT_LIMITS.maxUsd),
});
export type NightBudget = z.infer<typeof NightBudget>;

const TicketKey = z.string().regex(/^[A-Z][A-Z0-9]{0,9}-\d+$/);

export const NightLaunch = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  projectId: Id,
  /** The epic ticket's id, and its key for display and the `epic/<key>` branch. */
  epicId: Id,
  epicKey: TicketKey,
  budget: NightBudget,
  stopAt: Timestamp,
  status: NightLaunchStatus,
  /** The stories (child ticket keys) the launch covers, fixed at start. */
  storyKeys: z.array(TicketKey).max(NIGHT_LIMITS.maxStories),
  createdAt: Timestamp,
  /** `user:<uid>`, never an email. */
  createdBy: z.string().min(1).max(200),
  startedAt: Timestamp.nullable().default(null),
  endedAt: Timestamp.nullable().default(null),
  endReason: NightEndReason.nullable().default(null),
});
export type NightLaunch = z.infer<typeof NightLaunch>;

export function nightLaunchIsActive(launch: Pick<NightLaunch, "status">): boolean {
  return ACTIVE_NIGHT_STATUSES.includes(launch.status);
}

/**
 * What Andy sends to start a launch. Budget fields may be missing or not positive here: the
 * readiness check reports them as problems with the rest, instead of a bare schema error.
 */
export const StartNightLaunch = z.strictObject({
  epicId: Id,
  budget: z
    .strictObject({
      maxRuns: z.number().nullable().optional(),
      maxTokens: z.number().nullable().optional(),
      maxUsd: z.number().nullable().optional(),
    })
    .default({}),
  stopAt: Timestamp.nullable().optional(),
});
export type StartNightLaunch = z.input<typeof StartNightLaunch>;

export const LaunchProblemKind = z.enum([
  "not_epic",
  "no_stories",
  "too_many_stories",
  "open_questions",
  "not_ready",
  "plan_not_approved",
  "budget_missing",
  "budget_not_positive",
  "budget_over_cap",
  "stop_time_missing",
  "stop_time_past",
  "stop_time_too_far",
  "launch_running",
]);
export type LaunchProblemKind = z.infer<typeof LaunchProblemKind>;

/** One thing blocking a launch. `ticketKey`: the child (or epic) it is about; null for budget. */
export const LaunchProblem = z.object({
  kind: LaunchProblemKind,
  ticketKey: z.string().nullable(),
  message: z.string(),
});
export type LaunchProblem = z.infer<typeof LaunchProblem>;
