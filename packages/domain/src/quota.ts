import {
  RateLimitReport,
  type ProviderKey,
  type QuotaClearResult,
  type QuotaStore,
  type QuotaFreshness,
  type QuotaLevel,
  type QuotaReading,
  type QuotaStatus,
  type QuotaWindow,
  type QuotaWindowStatus,
} from "@andy/contracts";
import { DomainError } from "./tickets";

/**
 * Subscription quota (ARCHITECTURE §5, M1.9: Quota capture): turns what a run reports into
 * readings and readings into what the UI shows. The dispatcher stops at the pause level (ADR-0079).
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

/** How long a window can run, so a report can't claim a reset further off than that. */
const WINDOW_MS: Record<QuotaWindow, number> = {
  "5h": 5 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  daily_tasks: 24 * 60 * 60 * 1000,
};
/** Clock and rounding slack when comparing reset times. */
const RESET_TOLERANCE_MS = 5 * 60 * 1000;
/** Usage within one window only rises; this much slack covers rounding between events. */
export const QUOTA_MAX_DROP_PCT = 5;

export type QuotaRejection = "reset_too_far" | "window_mismatch" | "usage_drop";

/** Why a reported reading can't be believed, or null (threat model R24: reports are untrusted). */
export function quotaRejection(
  incoming: QuotaReading,
  stored: QuotaReading | undefined,
  now: Date,
): QuotaRejection | null {
  const nowMs = now.getTime();
  const incomingReset = incoming.resetsAt ? Date.parse(incoming.resetsAt) : null;
  if (incomingReset && incomingReset > nowMs + WINDOW_MS[incoming.window] + RESET_TOLERANCE_MS) {
    return "reset_too_far";
  }
  // An old stored reading can't veto a new one, so a false high can't lock itself in; nor can
  // one Andy discarded (AI-74), so the next real reading after a clear is believed.
  if (!stored || stored.discarded || !isRecent(stored, nowMs)) return null;
  const storedReset = stored.resetsAt ? Date.parse(stored.resetsAt) : null;
  if (storedReset && storedReset <= nowMs) return null; // That window is over.
  if (storedReset && incomingReset && Math.abs(storedReset - incomingReset) > RESET_TOLERANCE_MS) {
    return "window_mismatch";
  }
  return incoming.usedPct < stored.usedPct - QUOTA_MAX_DROP_PCT ? "usage_drop" : null;
}

function isRecent(reading: QuotaReading, nowMs: number): boolean {
  return nowMs - Date.parse(reading.takenAt) <= QUOTA_MAX_AGE_MS;
}

/**
 * The readings dispatch may act on: taken in the last 6 hours (ADR-0079). No run reports while
 * dispatch is idle, so without this limit one false high on the weekly window would stop dispatch
 * for a week; with it, the next run after 6 hours brings a new reading.
 */
export function readingsForDispatch(readings: QuotaReading[], now: Date): QuotaReading[] {
  return readings.filter((r) => !r.discarded && isRecent(r, now.getTime()));
}

/** The readings holding dispatch at the reserve: those `quotaStatus` puts at `pause` for it. */
export function readingsAtReserve(
  readings: QuotaReading[],
  now: Date,
  thresholds: QuotaThresholds = CLAUDE_SUB_THRESHOLDS,
): QuotaReading[] {
  return readingsForDispatch(readings, now).filter(
    (r) => quotaFreshness(r, now) === "fresh" && quotaLevel(r.usedPct, thresholds) === "pause",
  );
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
  // A reading Andy discarded (AI-74) reads as missing: unknown until the next one.
  const windows = windowsExpected.map((w) =>
    windowStatus(
      w,
      readings.find((r) => r.window === w && !r.discarded),
      now,
      thresholds,
    ),
  );
  const level = SEVERITY.find((l) => windows.some((w) => w.level === l)) ?? "unknown";
  return { provider, ...thresholds, level, windows };
}

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "quota", ...fields }));
}

/**
 * Andy's clear of a quota idle (AI-74): discards the readings holding dispatch at the reserve, so
 * quota reads unknown until the next reading and dispatch resumes under its other caps. The
 * readings stay, marked with who and when; each clear is kept in the store's history. At most
 * one clear per reading: the store refuses a reading already discarded.
 */
export class QuotaClearer {
  constructor(
    private readonly store: QuotaStore | null,
    private readonly now: () => Date = () => new Date(),
    /** Dispatches every project again. */
    private readonly wake: () => Promise<void> = async () => {},
  ) {}

  async clearIdle(by: string): Promise<QuotaClearResult> {
    const now = this.now();
    const held = this.store ? readingsAtReserve(await this.store.latest("claude-sub"), now) : [];
    const cleared =
      this.store && held.length > 0
        ? await this.store.discard(
            "claude-sub",
            held.map((r) => ({ window: r.window, takenAt: r.takenAt })),
            { by, at: now.toISOString() },
          )
        : [];
    if (cleared.length === 0) {
      throw new DomainError(
        "not_clearable",
        "No quota reading is holding dispatch at the reserve: nothing to clear",
      );
    }
    log("INFO", "quota idle cleared", {
      windows: cleared.map((c) => c.window),
      usedPct: cleared.map((c) => c.usedPct),
    });
    // The clear is committed; a failed wake-up only waits for the next one.
    try {
      await this.wake();
    } catch (err) {
      log("ERROR", "quota clear wake-up failed", { error: String(err) });
    }
    return { cleared };
  }
}
