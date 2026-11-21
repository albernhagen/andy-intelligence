import {
  EffectiveSpendCaps,
  ProjectSpendCaps,
  SpendCaps,
  SpendSoFar,
  type SpendCapKey,
} from "@andy/contracts";

/**
 * Spend caps rule (AI-235: M10.3): may this paid call go ahead? Pure and readable, for the UI and
 * dispatch reasons; the ledger (AI-234: M10.2) applies the same thresholds atomically. It fails
 * closed: unknown spend, no price, a missing cap or anything that doesn't parse is `unknown`,
 * which callers treat as a stop, never as `allow`.
 */

/** Checked in this order, so the first cap passed is the one reported (per task first). */
const ORDER: readonly SpendCapKey[] = [
  "per_task",
  "project_daily",
  "project_monthly",
  "global_daily",
  "global_monthly",
];

/**
 * A project's caps narrowed by the global ones: each project value counts only when it is lower
 * (global is the ceiling); a missing one is the global value. Per-task has one cap, the lower.
 */
export function effectiveCaps(
  global: SpendCaps,
  project: ProjectSpendCaps | null | undefined,
): EffectiveSpendCaps {
  const g = SpendCaps.parse(global);
  const p = ProjectSpendCaps.parse(project ?? {});
  const lower = (own: number | null | undefined, ceiling: number) =>
    own === null || own === undefined ? ceiling : Math.min(own, ceiling);
  return {
    per_task: lower(p.perTaskMicroUsd, g.perTaskMicroUsd),
    project_daily: lower(p.dailyMicroUsd, g.dailyMicroUsd),
    project_monthly: lower(p.monthlyMicroUsd, g.monthlyMicroUsd),
    global_daily: g.dailyMicroUsd,
    global_monthly: g.monthlyMicroUsd,
  };
}

export type SpendDecision =
  | { kind: "allow" }
  | { kind: "cap"; cap: SpendCapKey; limitMicroUsd: number; usedMicroUsd: number }
  /** Not known to be safe: treat as a stop. */
  | { kind: "unknown"; reason: "caps" | "totals" | "estimate" };

/**
 * `allow` only when the estimate is a known whole number of micro-dollars, the caps and totals
 * parse, and the estimate added to what each window has used stays at or under every cap.
 * Totals or estimate unknown (`"unknown"`, `null`, a fraction, a negative): `unknown`.
 */
export function maySpend(
  caps: unknown,
  totals: unknown,
  estimateMicroUsd: number | null,
): SpendDecision {
  const c = EffectiveSpendCaps.safeParse(caps);
  if (!c.success) return { kind: "unknown", reason: "caps" };
  const t = SpendSoFar.safeParse(totals);
  if (!t.success) return { kind: "unknown", reason: "totals" };
  if (
    estimateMicroUsd === null ||
    !Number.isSafeInteger(estimateMicroUsd) ||
    estimateMicroUsd < 0
  ) {
    return { kind: "unknown", reason: "estimate" };
  }
  const used: Record<SpendCapKey, number> = {
    per_task: 0,
    project_daily: t.data.project.dayMicroUsd,
    project_monthly: t.data.project.monthMicroUsd,
    global_daily: t.data.global.dayMicroUsd,
    global_monthly: t.data.global.monthMicroUsd,
  };
  for (const cap of ORDER) {
    if (used[cap] + estimateMicroUsd > c.data[cap]) {
      return { kind: "cap", cap, limitMicroUsd: c.data[cap], usedMicroUsd: used[cap] };
    }
  }
  return { kind: "allow" };
}
