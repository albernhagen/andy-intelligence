import { z } from "zod";

/**
 * Spend caps for paid models (M10: Paid models + spend caps, AI-235: M10.3). Integer
 * micro-dollars (1 USD = 1,000,000), never floats. The global caps are the ceiling; a project can
 * only lower them (routing-and-policy.md). The rule that reads them is `maySpend` in
 * `@andy/domain`; the ledger (AI-234: M10.2) enforces the same thresholds atomically.
 */

/** A non-negative whole number of micro-dollars. Local: AI-234's `MicroUsd` is the shared one. */
const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** The control plane's caps: every paid task, every project, and all projects together. */
export const SpendCaps = z.object({
  dailyMicroUsd: amount,
  monthlyMicroUsd: amount,
  perTaskMicroUsd: amount,
});
export type SpendCaps = z.infer<typeof SpendCaps>;

/** A project's own caps; a missing or null field takes the global value. */
export const ProjectSpendCaps = z.object({
  dailyMicroUsd: amount.nullable().optional(),
  monthlyMicroUsd: amount.nullable().optional(),
  perTaskMicroUsd: amount.nullable().optional(),
});
export type ProjectSpendCaps = z.infer<typeof ProjectSpendCaps>;

/**
 * Until Andy answers M10.1's question 1 (AI-227: M10.1: Spend design): $5 a day, $50 a month,
 * $2 per task. His answer changes these three numbers.
 */
export const DEFAULT_SPEND_CAPS: SpendCaps = {
  dailyMicroUsd: 5_000_000,
  monthlyMicroUsd: 50_000_000,
  perTaskMicroUsd: 2_000_000,
};

/** The caps one call is checked against, after a project's own caps narrowed the global ones. */
export const EffectiveSpendCaps = z.object({
  per_task: amount,
  project_daily: amount,
  project_monthly: amount,
  global_daily: amount,
  global_monthly: amount,
});
export type EffectiveSpendCaps = z.infer<typeof EffectiveSpendCaps>;

/** Which cap a call would pass. Same names as the ledger's `SpendCapName` (AI-234). */
export type SpendCapKey = keyof EffectiveSpendCaps;

/** Micro-dollars counted so far in the current UTC day and month. */
const Window = z.object({
  dayMicroUsd: amount,
  monthMicroUsd: amount,
});
export const SpendSoFar = z.object({ project: Window, global: Window });
export type SpendSoFar = z.infer<typeof SpendSoFar>;
