import { z } from "zod";
import { Id, RunStep, Size, Stage, Timestamp } from "./common";
import { QuotaDelta } from "./cost";

/**
 * Dashboards data (AI-102, ADR-0045): delivery and cost per week, per project and overall.
 * Computed on read from stored tickets, ticket events and runs; nothing is stored.
 */

/** Weeks one dashboard covers by default, and at most (ADR-0028: bounds the reads). */
export const DASHBOARD_DEFAULT_WEEKS = 8;
export const DASHBOARD_MAX_WEEKS = 26;

/** A figure a read cap left incomplete; `projects` means some projects were left out. */
export const DashboardFigure = z.enum([
  "projects",
  "ticketsByStage",
  "leadTime",
  "reworks",
  "ciGreenFirstTry",
  "reviewBlockers",
  "cost",
  "expensiveRuns",
]);
export type DashboardFigure = z.infer<typeof DashboardFigure>;

/** What finished agent tasks consumed. A task with no usage or no cost is unknown, not $0. */
export const DashboardCost = z.object({
  runs: z.number().int().nonnegative(),
  /** Tasks counted in `runs` whose cost is unknown; they add nothing to the sums below. */
  unknownCostRuns: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  /** Prompt tokens: input plus cache read and cache write. */
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
  /** Summed percentage points; null when no task had a comparable reading. */
  quotaDelta: QuotaDelta,
});
export type DashboardCost = z.infer<typeof DashboardCost>;

/** A ticket with no size, or a task with no ticket, counts as `unsized`. */
export const DashboardSize = z.enum([...Size.options, "unsized"]);
export type DashboardSize = z.infer<typeof DashboardSize>;

export const DashboardWeek = z.object({
  /** Monday 00:00 UTC. */
  start: Timestamp,
  /** The next Monday, or now for the current week. */
  end: Timestamp,
  /** Tickets in each stage at the week's end, archived ones included. */
  ticketsByStage: z.record(Stage, z.number().int().nonnegative()),
  /**
   * Hours from a ticket's first move into Ready (or In progress, if it skipped Ready) to its move
   * into Done, for moves into Done this week; a re-opened ticket's next completion is measured
   * from its first such move after the reopen. Nearest-rank percentiles, null with no samples.
   */
  leadTimeHours: z.object({
    median: z.number().nonnegative().nullable(),
    p90: z.number().nonnegative().nullable(),
    count: z.number().int().nonnegative(),
  }),
  /** Moves from Ready for review back to In progress this week. */
  reworks: z.number().int().nonnegative(),
  /** Tasks ended this week whose PR has a first-try verdict; `rate` is green ÷ known. */
  ciGreenFirstTry: z.object({
    green: z.number().int().nonnegative(),
    known: z.number().int().nonnegative(),
    rate: z.number().min(0).max(1).nullable(),
  }),
  /** Review checks that failed, summed over tasks ended this week. */
  reviewBlockers: z.number().int().nonnegative(),
  cost: DashboardCost,
  /** One entry per step, in `RunStep` order. */
  byStep: z.array(DashboardCost.extend({ step: RunStep })),
  /** One entry per size: S, M, L, unsized. */
  bySize: z.array(DashboardCost.extend({ size: DashboardSize })),
});
export type DashboardWeek = z.infer<typeof DashboardWeek>;

/** One of the window's most expensive finished agent tasks. */
export const DashboardRun = z.object({
  id: Id,
  projectId: Id,
  ticketId: Id.nullable(),
  ticketKey: z.string().nullable(),
  step: RunStep,
  costUsd: z.number().nonnegative(),
  costIsEstimate: z.boolean(),
  endedAt: Timestamp,
});
export type DashboardRun = z.infer<typeof DashboardRun>;

/** How many of the most expensive tasks a dashboard lists. */
export const DASHBOARD_EXPENSIVE_RUNS = 5;

const figures = {
  from: Timestamp,
  to: Timestamp,
  /** Oldest first; the last is the current week. */
  weeks: z.array(DashboardWeek),
  /** The window's most expensive tasks, costliest first. */
  expensiveRuns: z.array(DashboardRun).max(DASHBOARD_EXPENSIVE_RUNS),
  /** Figures a read cap truncated; empty when every figure is complete. */
  partial: z.array(DashboardFigure),
};

export const ProjectDashboard = z.object({ projectId: Id, key: z.string(), ...figures });
export type ProjectDashboard = z.infer<typeof ProjectDashboard>;

/** All projects: the figures summed across them, then each project's own. */
export const Dashboard = z.object({ ...figures, projects: z.array(ProjectDashboard) });
export type Dashboard = z.infer<typeof Dashboard>;
