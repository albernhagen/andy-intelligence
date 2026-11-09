import {
  RateLimitReport,
  type ProviderKey,
  type QuotaFreshness,
  type QuotaLevel,
  type QuotaReading,
  type QuotaStatus,
  type QuotaWindow,
  type QuotaWindowStatus,
} from "@andy/contracts";

/**
 * Subscription quota (ARCHITECTURE §5, M1.9: Quota capture): turns what a run reports into
 * readings and readings into what the UI shows. Nothing here gates dispatch yet (M2).
 */

export const QUOTA_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const CLAUDE_SUB_SOURCE = "claude-code-rate-limit-event";

export interface QuotaThresholds {
  warnPct: number;
  pausePct: number;
}

/** §5 default global policy. No Provider documents exist yet; read them here when they do. */
export const CLAUDE_SUB_THRESHOLDS: QuotaThresholds = { warnPct: 70, pausePct: 80 };

const CLAUDE_SUB_WINDOWS: QuotaWindow[] = ["5h", "weekly"];

export type ParsedRateLimits =
  { ok: true; readings: QuotaReading[] } | { ok: false; issues: string[] };

const WINDOW_BY_TYPE: Record<string, QuotaWindow> = { five_hour: "5h", seven_day: "weekly" };

/**
 * One reading per window. `raw` is untrusted; absent or windowless data is "no readings" and
 * a wrong shape is `ok: false`, with issue paths only, so nothing from the payload reaches a log.
 */
export function parseRateLimits(raw: unknown, now: Date): ParsedRateLimits {
  if (raw === undefined || raw === null) return { ok: true, readings: [] };
  const parsed = RateLimitReport.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`),
    };
  }
  const { unifiedWindows, rateLimitType, utilization, resetsAt } = parsed.data;
  const found = new Map<QuotaWindow, { utilization: number; resetsAt?: number }>();
  // The top-level fields describe only the limiting window; per-window data wins over them.
  const limiting = rateLimitType ? WINDOW_BY_TYPE[rateLimitType] : undefined;
  if (limiting && utilization !== undefined) found.set(limiting, { utilization, resetsAt });
  if (unifiedWindows?.five_hour) found.set("5h", unifiedWindows.five_hour);
  if (unifiedWindows?.seven_day) found.set("weekly", unifiedWindows.seven_day);

  const readings = [...found].map(([window, usage]): QuotaReading => ({
    provider: "claude-sub",
    window,
    usedPct: Math.min(100, Math.round(usage.utilization * 1000) / 10),
    resetsAt: usage.resetsAt ? new Date(usage.resetsAt * 1000).toISOString() : null,
    source: CLAUDE_SUB_SOURCE,
    takenAt: now.toISOString(),
    confidence: "high",
  }));
  return { ok: true, readings };
}

/** Fresh until the window's reset passes; with no reset time, for 6 hours after it was taken. */
export function quotaFreshness(reading: QuotaReading | undefined, now: Date): QuotaFreshness {
  if (!reading) return "unknown";
  const fresh = reading.resetsAt
    ? now.getTime() <= new Date(reading.resetsAt).getTime()
    : now.getTime() - new Date(reading.takenAt).getTime() <= QUOTA_MAX_AGE_MS;
  return fresh ? "fresh" : "stale";
}

export function quotaLevel(usedPct: number, thresholds: QuotaThresholds): QuotaLevel {
  if (usedPct >= thresholds.pausePct) return "pause";
  return usedPct >= thresholds.warnPct ? "warn" : "ok";
}

function windowStatus(
  window: QuotaWindow,
  reading: QuotaReading | undefined,
  now: Date,
  thresholds: QuotaThresholds,
): QuotaWindowStatus {
  const freshness = quotaFreshness(reading, now);
  const fresh = freshness === "fresh" && reading !== undefined;
  return {
    window,
    freshness,
    level: fresh ? quotaLevel(reading.usedPct, thresholds) : "unknown",
    usedPct: fresh ? reading.usedPct : null,
    resetsAt: reading?.resetsAt ?? null,
    takenAt: reading?.takenAt ?? null,
    source: reading?.source ?? null,
  };
}

const SEVERITY: QuotaLevel[] = ["pause", "warn", "unknown", "ok"];

/** A provider's windows and its worst level. Stale and missing readings both read as unknown. */
export function quotaStatus(
  provider: ProviderKey,
  readings: QuotaReading[],
  now: Date,
  thresholds: QuotaThresholds = CLAUDE_SUB_THRESHOLDS,
  windowsExpected: QuotaWindow[] = CLAUDE_SUB_WINDOWS,
): QuotaStatus {
  const windows = windowsExpected.map((w) =>
    windowStatus(
      w,
      readings.find((r) => r.window === w),
      now,
      thresholds,
    ),
  );
  const level = SEVERITY.find((l) => windows.some((w) => w.level === l)) ?? "unknown";
  return { provider, ...thresholds, level, windows };
}
