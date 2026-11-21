import { InMemoryRunStore, QuotaReading, type NewRun } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import {
  GOOGLE_SUB_SOURCE,
  GOOGLE_SUB_THRESHOLDS,
  JULES_COUNT_READ_CAP,
  julesQuotaReading,
  utcDayStart,
} from "./jules-quota";
import { quotaLevel } from "./quota";

const NOW = new Date("2026-11-21T15:30:00.000Z");
const DAY = utcDayStart(NOW);

describe("julesQuotaReading", () => {
  it("Given12Of15TasksStarted_WhenRead_ThenEightyPercentUsed", () => {
    const reading = julesQuotaReading({ count: 12, complete: true }, 15, DAY, NOW);
    expect(reading).toEqual({
      provider: "google-sub",
      window: "daily_tasks",
      usedPct: 80,
      resetsAt: "2026-11-22T00:00:00.000Z",
      source: GOOGLE_SUB_SOURCE,
      takenAt: NOW.toISOString(),
      confidence: "high",
    });
    expect(QuotaReading.parse(reading)).toEqual(reading);
    expect(quotaLevel(reading!.usedPct, GOOGLE_SUB_THRESHOLDS)).toBe("pause");
  });

  it.each([null, 0, -3, Number.NaN])(
    "GivenNoDailyLimit%s_WhenRead_ThenUnknownNeverANumber",
    (limit) => {
      expect(julesQuotaReading({ count: 4, complete: true }, limit, DAY, NOW)).toBeNull();
    },
  );

  it("GivenMoreTasksThanTheLimit_WhenRead_ThenCappedAtOneHundred", () => {
    expect(julesQuotaReading({ count: 20, complete: true }, 15, DAY, NOW)?.usedPct).toBe(100);
  });

  it("GivenACountThatHitItsReadCap_WhenRead_ThenOneHundredPercentFailClosed", () => {
    expect(julesQuotaReading({ count: 3, complete: false }, 15, DAY, NOW)?.usedPct).toBe(100);
  });
});

describe("utcDayStart", () => {
  it("GivenATimeOfDay_WhenAsked_ThenMidnightUtcThatDay", () => {
    expect(utcDayStart(NOW).toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });
});

describe("counting google-sub tasks", () => {
  const run = (provider: "claude-sub" | "google-sub"): NewRun => ({
    projectId: "ai",
    ticketId: "t1",
    step: "build",
    route:
      provider === "google-sub"
        ? { harness: "jules", provider, model: "jules" }
        : { harness: "claude-code", provider, model: "sonnet" },
    tier: null,
  });

  it("GivenRunsOnOtherProvidersAndYesterday_WhenCountedForToday_ThenOnlyTodaysGoogleSubRuns", async () => {
    let now = new Date("2026-11-20T23:00:00.000Z");
    const runs = new InMemoryRunStore(() => now);
    await runs.create(run("google-sub"));
    now = NOW;
    await runs.create(run("google-sub"));
    await runs.create(run("google-sub"));
    await runs.create(run("claude-sub"));
    const started = await runs.countCreatedSince(
      "google-sub",
      utcDayStart(NOW).toISOString(),
      JULES_COUNT_READ_CAP,
    );
    expect(started).toEqual({ count: 2, complete: true });
    expect(julesQuotaReading(started, 10, DAY, NOW)?.usedPct).toBe(20);
  });

  it("GivenOtherProvidersFillTheReadCap_WhenCounted_ThenIncompleteAndReadAsFullyUsed", async () => {
    const runs = new InMemoryRunStore(() => NOW);
    await runs.create(run("google-sub"));
    for (let i = 0; i < 3; i++) await runs.create(run("claude-sub"));
    const started = await runs.countCreatedSince("google-sub", DAY.toISOString(), 3);
    expect(started.complete).toBe(false);
    expect(julesQuotaReading(started, 10, DAY, NOW)?.usedPct).toBe(100);
  });
});
