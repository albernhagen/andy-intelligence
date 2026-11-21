import { z } from "zod";
import { Id, ProviderKey, Timestamp } from "./common";

/**
 * Spend ledger (M10: Paid models + spend caps, AI-234: M10.2). A paid task reserves its
 * worst-case cost before it starts, then settles to the actual cost or releases it. Amounts are
 * integer micro-dollars (1 USD = 1,000,000), never floats, so totals add exactly.
 */

export const MICRO_USD_PER_USD = 1_000_000;

/** A non-negative amount in micro-dollars. */
export const MicroUsd = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export type MicroUsd = z.infer<typeof MicroUsd>;

/** `reserved` counts its reservation; `settled` its actual cost; `released` nothing. */
export const SpendState = z.enum(["reserved", "settled", "released"]);
export type SpendState = z.infer<typeof SpendState>;

export const SpendEntry = z.object({
  id: Id,
  runId: Id,
  projectId: Id,
  provider: ProviderKey,
  model: z.string().min(1).max(200),
  state: SpendState,
  reservedMicroUsd: MicroUsd,
  /** The actual cost once settled; null while reserved or after a release. */
  settledMicroUsd: MicroUsd.nullable(),
  /** When it was reserved: the UTC day and month it counts in. */
  at: Timestamp,
  /** When it was settled or released; null while reserved. */
  settledAt: Timestamp.nullable(),
});
export type SpendEntry = z.infer<typeof SpendEntry>;

/** What a reservation may not pass. */
export const SpendCapName = z.enum([
  "per_task",
  "project_daily",
  "project_monthly",
  "global_daily",
  "global_monthly",
]);
export type SpendCapName = z.infer<typeof SpendCapName>;

/**
 * The caps one reservation is checked against, as plain numbers (M10.3 decides where they come
 * from). Null: no cap at this level. Failing closed when caps are unknown is the caller's job
 * (M10.7: Spend gate at dispatch), not the ledger's.
 */
export const SpendCapLimits = z.object(
  Object.fromEntries(SpendCapName.options.map((n) => [n, MicroUsd.nullable()])) as Record<
    SpendCapName,
    z.ZodNullable<typeof MicroUsd>
  >,
);
export type SpendCapLimits = z.infer<typeof SpendCapLimits>;

/** What counts against the caps in one UTC day and the UTC month around it. */
export const SpendTotals = z.object({
  /** UTC date, "YYYY-MM-DD". */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayMicroUsd: MicroUsd,
  /** UTC month, "YYYY-MM". */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  monthMicroUsd: MicroUsd,
});
export type SpendTotals = z.infer<typeof SpendTotals>;

/** How much an entry counts now: its reservation, its actual cost, or nothing once released. */
export function spendCounted(entry: SpendEntry): number {
  if (entry.state === "released") return 0;
  if (entry.state === "settled") return entry.settledMicroUsd ?? entry.reservedMicroUsd;
  return entry.reservedMicroUsd;
}

/**
 * The first cap a new reservation of `amount` would pass, given the totals it joins, or null.
 * Checked in a fixed order (per task, project, global; day before month), so every adapter
 * reports the same cap.
 */
export function spendCapPassed(
  amount: number,
  caps: SpendCapLimits,
  project: Pick<SpendTotals, "dayMicroUsd" | "monthMicroUsd">,
  global: Pick<SpendTotals, "dayMicroUsd" | "monthMicroUsd">,
): { cap: SpendCapName; limitMicroUsd: number; usedMicroUsd: number } | null {
  const checks: [SpendCapName, number][] = [
    ["per_task", 0],
    ["project_daily", project.dayMicroUsd],
    ["project_monthly", project.monthMicroUsd],
    ["global_daily", global.dayMicroUsd],
    ["global_monthly", global.monthMicroUsd],
  ];
  for (const [cap, used] of checks) {
    const limit = caps[cap];
    if (limit !== null && used + amount > limit) {
      return { cap, limitMicroUsd: limit, usedMicroUsd: used };
    }
  }
  return null;
}
