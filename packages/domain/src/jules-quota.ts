import type { QuotaReading } from "@andy/contracts";
import type { QuotaThresholds } from "./quota";

/**
 * google-sub quota by task counting (AI-232: M9.5, routing-and-policy.md §5). Jules reports no
 * usage, so the reading is the Jules agent tasks the control plane started in the current window
 * divided by the plan's daily task limit. Pure: the count comes from
 * `RunStore.countCreatedSince`. The window and limit come from M9.2's spike findings; until then
 * the window is the UTC day and the limit is passed in. Wiring into the header and dispatch is
 * M9.6 and later.
 */

export const GOOGLE_SUB_SOURCE = "counted";

/** §5 default global policy for google-sub: reserve 20% of daily tasks, warn 70, pause 80. */
export const GOOGLE_SUB_THRESHOLDS: QuotaThresholds = { warnPct: 70, pausePct: 80 };

/**
 * Most runs one count reads (ADR-0028). Runs on every provider count toward it (see
 * `RunStore.countCreatedSince`), so it sits well above any day's dispatch caps; a count that
 * reaches it reads as 100% used, never less.
 */
export const JULES_COUNT_READ_CAP = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of `now`'s UTC day: the window until M9.2 says otherwise. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** What `RunStore.countCreatedSince` returned for google-sub since the window's start. */
export interface StartedCount {
  count: number;
  /** False when the count hit its read cap, so more tasks may have started. */
  complete: boolean;
}

/**
 * A `daily_tasks` reading: `started.count` of `dailyLimit` used, capped at 100%. Null (unknown,
 * never a number) when no positive limit is set. A count that hit its read cap reads as 100%:
 * fail closed (ADR-0028).
 */
export function julesQuotaReading(
  started: StartedCount,
  dailyLimit: number | null,
  windowStart: Date,
  now: Date,
): QuotaReading | null {
  if (dailyLimit === null || !Number.isFinite(dailyLimit) || dailyLimit <= 0) return null;
  const usedPct = started.complete ? Math.min(100, (started.count / dailyLimit) * 100) : 100;
  return {
    provider: "google-sub",
    window: "daily_tasks",
    usedPct,
    resetsAt: new Date(windowStart.getTime() + DAY_MS).toISOString(),
    source: GOOGLE_SUB_SOURCE,
    takenAt: now.toISOString(),
    confidence: "high",
  };
}
