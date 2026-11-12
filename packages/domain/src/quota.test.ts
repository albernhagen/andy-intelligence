import { InMemoryQuotaStore, type QuotaReading } from "@andy/contracts";
import { describe, expect, it, vi } from "vitest";
import { DomainError } from "./tickets";
import {
  QuotaClearer,
  readingsAtReserve,
  readingsForDispatch,
  quotaRejection,
  QUOTA_MAX_AGE_MS,
  parseRateLimits,
  quotaFreshness,
  quotaLevel,
  quotaStatus,
} from "./quota";

/** The owner as owner-only rules take them (AI-19). */
const OWNER = { actor: "andy", email: "andy@example.com" };

const now = new Date("2026-11-08T12:00:00.000Z");
const epoch = (iso: string) => new Date(iso).getTime() / 1000;
const RESET = "2026-11-08T15:00:00.000Z";
const thresholds = { warnPct: 70, pausePct: 80 };
const reading = (over: Partial<QuotaReading> = {}): QuotaReading => ({
  provider: "claude-sub",
  window: "5h",
  usedPct: 10,
  resetsAt: RESET,
  source: "test",
  takenAt: now.toISOString(),
  confidence: "high",
  ...over,
});
const windows = (five: number, seven: number) => ({
  unifiedWindows: {
    five_hour: { utilization: five, resetsAt: epoch(RESET) },
    seven_day: { utilization: seven, resetsAt: epoch(RESET) },
  },
});

describe("parseRateLimits", () => {
  it("GivenBothWindows_WhenParsed_ThenOneReadingPerWindowInPercent", () => {
    const parsed = parseRateLimits(windows(0.423, 0.1), now);
    expect(parsed).toEqual({
      ok: true,
      readings: [
        expect.objectContaining({ window: "5h", usedPct: 42.3, resetsAt: RESET }),
        expect.objectContaining({ window: "weekly", usedPct: 10, takenAt: now.toISOString() }),
      ],
    });
  });

  it("GivenUsagePastTheCap_WhenParsed_ThenItIsCappedAt100", () => {
    const parsed = parseRateLimits(windows(1.3, 0), now);
    expect(parsed.ok && parsed.readings[0]?.usedPct).toBe(100);
  });

  it("GivenOnlyTheLimitingWindow_WhenParsed_ThenItBecomesOneReading", () => {
    const parsed = parseRateLimits({ rateLimitType: "seven_day", utilization: 0.9 }, now);
    expect(parsed).toEqual({
      ok: true,
      readings: [expect.objectContaining({ window: "weekly", usedPct: 90, resetsAt: null })],
    });
  });

  it.each([[undefined], [null], [{}], [{ rateLimitType: "overage", utilization: 0.5 }]])(
    "GivenNoUsableWindow_WhenParsed_ThenNoReadings %#",
    (raw) => {
      expect(parseRateLimits(raw, now)).toEqual({ ok: true, readings: [] });
    },
  );

  it.each([
    ["not an object", "garbage"],
    ["a string usage", { unifiedWindows: { five_hour: { utilization: "lots", resetsAt: 1 } } }],
    ["negative usage", windows(-1, 0)],
    ["a reset Date can't hold", { resetsAt: 1e20 }],
  ])("GivenMalformedData_WhenParsed_ThenIssuesWithoutThePayload: %s", (_name, raw) => {
    const parsed = parseRateLimits(raw, now);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.join()).not.toContain("lots");
  });
});

describe("quotaFreshness", () => {
  it("GivenNoReading_WhenChecked_ThenUnknown", () => {
    expect(quotaFreshness(undefined, now)).toBe("unknown");
  });

  it("GivenAResetTime_WhenChecked_ThenFreshExactlyUntilItPasses", () => {
    const r = reading({ takenAt: "2026-11-01T00:00:00.000Z" });
    expect(quotaFreshness(r, new Date(RESET))).toBe("fresh");
    expect(quotaFreshness(r, new Date(new Date(RESET).getTime() + 1))).toBe("stale");
  });

  it("GivenNoResetTime_WhenChecked_ThenFreshFor6Hours", () => {
    const r = reading({ resetsAt: null });
    expect(quotaFreshness(r, new Date(now.getTime() + QUOTA_MAX_AGE_MS))).toBe("fresh");
    expect(quotaFreshness(r, new Date(now.getTime() + QUOTA_MAX_AGE_MS + 1))).toBe("stale");
  });
});

describe("quotaLevel", () => {
  it.each([
    [69.9, "ok"],
    [70, "warn"],
    [79.9, "warn"],
    [80, "pause"],
    [100, "pause"],
  ])("GivenUsedPct%s_WhenLevelled_Then%s", (pct, level) => {
    expect(quotaLevel(pct, thresholds)).toBe(level);
  });
});

describe("quotaStatus", () => {
  it("GivenNoReadings_WhenSummarised_ThenEveryWindowIsUnknownWithNoNumber", () => {
    const status = quotaStatus("claude-sub", [], now);
    expect(status.level).toBe("unknown");
    expect(status.windows.map((w) => [w.window, w.freshness, w.usedPct])).toEqual([
      ["5h", "unknown", null],
      ["weekly", "unknown", null],
    ]);
  });

  it("GivenAStaleReading_WhenSummarised_ThenItHidesTheOldNumber", () => {
    const old = reading({ usedPct: 5, resetsAt: "2026-11-08T11:00:00.000Z" });
    const [five] = quotaStatus("claude-sub", [old], now).windows;
    expect(five).toMatchObject({ freshness: "stale", level: "unknown", usedPct: null });
  });

  it("GivenAWarnAndAnUnknownWindow_WhenSummarised_ThenTheWorstLevelIsWarn", () => {
    expect(quotaStatus("claude-sub", [reading({ usedPct: 75 })], now).level).toBe("warn");
  });

  it("GivenAWarnAndAPauseWindow_WhenSummarised_ThenTheWorstLevelIsPause", () => {
    const readings = [reading({ usedPct: 75 }), reading({ window: "weekly", usedPct: 85 })];
    expect(quotaStatus("claude-sub", readings, now).level).toBe("pause");
  });

  it("GivenOneOkAndOneUnknownWindow_WhenSummarised_ThenTheLevelIsUnknownNotOk", () => {
    expect(quotaStatus("claude-sub", [reading()], now).level).toBe("unknown");
  });

  it("GivenBothWindowsOk_WhenSummarised_ThenOk", () => {
    const readings = [reading(), reading({ window: "weekly" })];
    expect(quotaStatus("claude-sub", readings, now).level).toBe("ok");
  });
});

describe("quotaRejection", () => {
  const at = new Date("2026-11-09T12:00:00.000Z");
  const hours = (h: number) => new Date(at.getTime() + h * 3_600_000).toISOString();
  const reading = (extra: Partial<QuotaReading> = {}): QuotaReading => ({
    provider: "claude-sub",
    window: "5h",
    usedPct: 50,
    resetsAt: hours(3),
    source: "test",
    takenAt: at.toISOString(),
    confidence: "high",
    ...extra,
  });
  const stored = reading({ takenAt: hours(-1) });

  it("GivenNothingStored_WhenAPlausibleReadingArrives_ThenItIsBelieved", () => {
    expect(quotaRejection(reading(), undefined, at)).toBeNull();
  });

  it("GivenAResetFurtherOffThanTheWindow_WhenChecked_ThenRejected", () => {
    expect(quotaRejection(reading({ resetsAt: hours(6) }), undefined, at)).toBe("reset_too_far");
  });

  it("GivenAWeeklyResetInSixDays_WhenChecked_ThenBelieved", () => {
    expect(
      quotaRejection(reading({ window: "weekly", resetsAt: hours(144) }), undefined, at),
    ).toBeNull();
  });

  it("GivenARecentReading_WhenUsageRisesInTheSameWindow_ThenBelieved", () => {
    expect(quotaRejection(reading({ usedPct: 70 }), stored, at)).toBeNull();
  });

  it("GivenARecentReading_WhenUsageDropsPastTheSlack_ThenRejected", () => {
    expect(quotaRejection(reading({ usedPct: 44 }), stored, at)).toBe("usage_drop");
  });

  it("GivenARecentReading_WhenUsageDropsWithinTheSlack_ThenBelieved", () => {
    expect(quotaRejection(reading({ usedPct: 45 }), stored, at)).toBeNull();
  });

  it("GivenARecentReading_WhenANewWindowIsClaimedBeforeItsReset_ThenRejected", () => {
    expect(quotaRejection(reading({ usedPct: 1, resetsAt: hours(4) }), stored, at)).toBe(
      "window_mismatch",
    );
  });

  it("GivenTheStoredWindowIsOver_WhenALowerReadingArrives_ThenBelieved", () => {
    const over = reading({ usedPct: 90, resetsAt: hours(-0.5), takenAt: hours(-1) });
    expect(quotaRejection(reading({ usedPct: 1 }), over, at)).toBeNull();
  });

  it("GivenAStoredReadingOverSixHoursOld_WhenALowerReadingArrives_ThenAFalseHighCantLockItselfIn", () => {
    const old = reading({
      window: "weekly",
      usedPct: 99,
      resetsAt: hours(100),
      takenAt: hours(-7),
    });
    expect(
      quotaRejection(reading({ window: "weekly", usedPct: 20, resetsAt: hours(50) }), old, at),
    ).toBeNull();
  });
});

describe("clear quota idle (AI-74)", () => {
  const discarded = { by: "andy@example.com", at: now.toISOString() };

  it("GivenADiscardedReading_WhenStatusIsRead_ThenItsWindowIsUnknown", () => {
    const status = quotaStatus("claude-sub", [reading({ usedPct: 95, discarded })], now);
    expect(status.windows[0]).toMatchObject({ window: "5h", level: "unknown", usedPct: null });
    expect(readingsForDispatch([reading({ usedPct: 95, discarded })], now)).toEqual([]);
  });

  it("GivenADiscardedHighReading_WhenALowerOneArrives_ThenItIsNotRejectedAsADrop", () => {
    const stored = reading({ usedPct: 95 });
    const lower = reading({ usedPct: 30 });
    expect(quotaRejection(lower, stored, now)).toBe("usage_drop");
    expect(quotaRejection(lower, { ...stored, discarded }, now)).toBeNull();
  });

  it("GivenReadingsAtAndBelowThePauseLevel_WhenAtReserve_ThenOnlyThePauseOnesHold", () => {
    const high = reading({ window: "weekly", usedPct: 85 });
    expect(readingsAtReserve([reading({ usedPct: 75 }), high], now)).toEqual([high]);
    expect(readingsAtReserve([{ ...high, discarded }], now)).toEqual([]);
  });

  it("GivenAReadingAtTheReserve_WhenCleared_ThenDiscardedAndDispatchIsWoken", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const store = new InMemoryQuotaStore();
    await store.save([reading({ usedPct: 92 }), reading({ window: "weekly", usedPct: 20 })]);
    const wake = vi.fn(async () => {});
    const result = await new QuotaClearer(store, () => now, wake).clearIdle(OWNER);
    expect(result.cleared).toEqual([
      expect.objectContaining({ window: "5h", usedPct: 92, by: "andy@example.com" }),
    ]);
    expect(wake).toHaveBeenCalledOnce();
    expect(quotaStatus("claude-sub", await store.latest("claude-sub"), now).level).toBe("unknown");
  });

  it("GivenAnAgent_WhenClearingAQuotaIdle_ThenForbiddenAndNothingIsDiscarded", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const store = new InMemoryQuotaStore();
    await store.save([reading({ usedPct: 92 })]);
    const clearer = new QuotaClearer(store, () => now);
    await expect(
      clearer.clearIdle({ actor: "agent:r1", email: "andy@example.com" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(quotaStatus("claude-sub", await store.latest("claude-sub"), now).level).not.toBe(
      "unknown",
    );
  });

  it("GivenNothingAtTheReserve_WhenCleared_ThenRefusedAndNothingIsWoken", async () => {
    const store = new InMemoryQuotaStore();
    await store.save([reading({ usedPct: 50 })]);
    const wake = vi.fn(async () => {});
    const clearer = new QuotaClearer(store, () => now, wake);
    await expect(clearer.clearIdle(OWNER)).rejects.toMatchObject({
      code: "not_clearable",
    });
    await expect(new QuotaClearer(null).clearIdle(OWNER)).rejects.toBeInstanceOf(DomainError);
    expect(wake).not.toHaveBeenCalled();
  });
});
