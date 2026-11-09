import { z } from "zod";

/** What a run consumed, from its report (AI-67: Cost per run). */
export const RunUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative().nullable(),
  wallMs: z.number().int().nonnegative().nullable(),
});
export type RunUsage = z.infer<typeof RunUsage>;

/** Percentage points of each subscription window; null when no comparable readings exist. */
export const QuotaDelta = z.object({
  "5h": z.number().nonnegative().nullable(),
  weekly: z.number().nonnegative().nullable(),
});
export type QuotaDelta = z.infer<typeof QuotaDelta>;

/** Spread into `Run`. Defaults keep older documents readable (no schema version bump). */
export const RunCostFields = {
  /** Null when the report carried no usage: the run's cost is unknown. */
  usage: RunUsage.nullable().default(null),
  quotaDelta: QuotaDelta.nullable().default(null),
};

/** Totals over a ticket's finished runs. Active runs are not counted yet. */
export const TicketCost = z.object({
  /** Runs with an unknown cost add nothing here; see `unknownRuns`. */
  estimatedCostUsd: z.number().nonnegative(),
  quotaDelta: QuotaDelta,
  completedRuns: z.number().int().nonnegative(),
  unknownRuns: z.number().int().nonnegative(),
});
export type TicketCost = z.infer<typeof TicketCost>;
