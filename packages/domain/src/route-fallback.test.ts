import {
  DEFAULT_ROUTING,
  type ProviderKey,
  type ProviderRouting,
  type QuotaLevel,
  type QuotaReading,
  type Route,
} from "@andy/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  chooseRoute,
  dispatchQuotaLevel,
  routeAvailability,
  subscriptionLevel,
  type RouteAvailability,
} from "./route-fallback";
import type { RouteCandidate } from "./route-resolver";

/** AI-261: M10.14: Quota-aware route fallback (pure parts). */

const NOW = new Date("2026-11-21T12:00:00.000Z");
const OPUS: Route = { harness: "claude-code", provider: "claude-sub", model: "opus" };
const JULES: Route = { harness: "jules", provider: "google-sub", model: "gemini-pro" };
const PAID: Route = { harness: "opencode", provider: "openrouter", model: "vendor/model-x" };

const ok = (route: Route): RouteCandidate => ({ route, problem: null });
const answers =
  (byProvider: Partial<Record<ProviderKey, RouteAvailability>>) => async (route: Route) =>
    byProvider[route.provider] ?? ({ kind: "ok" } as const);
const PAUSE: RouteAvailability = {
  kind: "skip",
  reason: "claude-sub quota is at its pause level (80% used), keeping the reserve",
  idle: "quota_reserve",
};
const CAP: RouteAvailability = {
  kind: "skip",
  reason: "no paid agent task: it would pass the daily cap",
  idle: "spend_cap",
};
const UNKNOWN: RouteAvailability = { kind: "unknown", reason: "quota reading is stale or missing" };

const providers = (
  on: Partial<Record<ProviderKey, boolean>>,
): Record<ProviderKey, ProviderRouting> => {
  const p = structuredClone(DEFAULT_ROUTING.providers);
  for (const [k, v] of Object.entries(on)) p[k as ProviderKey].enabled = v;
  return p;
};

describe("chooseRoute", () => {
  it("GivenTheFirstRoutesSubscriptionAtItsPauseLevel_WhenChoosing_ThenTheNextRouteAndWhy", async () => {
    const chosen = await chooseRoute([ok(OPUS), ok(JULES)], answers({ "claude-sub": PAUSE }));
    expect(chosen).toEqual({ route: JULES, skipped: [{ route: OPUS, reason: PAUSE.reason }] });
  });

  it("GivenEveryRouteAtItsReserve_WhenChoosing_ThenNoRouteAndQuotaReserve", async () => {
    const chosen = await chooseRoute(
      [ok(OPUS), ok(JULES)],
      answers({ "claude-sub": PAUSE, "google-sub": PAUSE }),
    );
    expect(chosen).toMatchObject({ route: null, idle: "quota_reserve" });
    expect(chosen.skipped.map((s) => s.route)).toEqual([OPUS, JULES]);
  });

  it("GivenAReserveThenAPaidRouteAtItsCap_WhenChoosing_ThenTheFirstSkipsIdleReason", async () => {
    const chosen = await chooseRoute(
      [ok(OPUS), ok(PAID)],
      answers({ "claude-sub": PAUSE, openrouter: CAP }),
    );
    expect(chosen).toMatchObject({ route: null, idle: "quota_reserve" });
  });

  it("GivenOnlyAPaidRouteAtItsCap_WhenChoosing_ThenNoRouteAndSpendCap", async () => {
    const chosen = await chooseRoute([ok(PAID)], answers({ openrouter: CAP }));
    expect(chosen).toEqual({
      route: null,
      skipped: [{ route: PAID, reason: CAP.reason }],
      idle: "spend_cap",
    });
  });

  it("GivenAStaleReadingAndAnotherUsableRoute_WhenChoosing_ThenTheOtherRouteIsPreferred", async () => {
    const chosen = await chooseRoute([ok(OPUS), ok(JULES)], answers({ "claude-sub": UNKNOWN }));
    expect(chosen.route).toEqual(JULES);
    expect(chosen.skipped).toEqual([
      { route: OPUS, reason: `${UNKNOWN.reason}; preferred a route with room` },
    ]);
  });

  it("GivenOnlyUnknownReadings_WhenChoosing_ThenTheFirstRunsAsToday", async () => {
    const chosen = await chooseRoute(
      [ok(OPUS), ok(JULES)],
      answers({ "claude-sub": UNKNOWN, "google-sub": UNKNOWN }),
    );
    expect(chosen.route).toEqual(OPUS);
    expect(chosen.skipped.map((s) => s.route)).toEqual([JULES]);
  });

  it("GivenAPaidRouteRefusedThenAnUnknownReading_WhenChoosing_ThenTheUnknownRouteRuns", async () => {
    const chosen = await chooseRoute(
      [ok(PAID), ok(OPUS)],
      answers({ openrouter: CAP, "claude-sub": UNKNOWN }),
    );
    expect(chosen.route).toEqual(OPUS);
  });

  it("GivenAReserveThenAnUnknownReading_WhenChoosing_ThenItFailsClosedOnTheReserve", async () => {
    const chosen = await chooseRoute(
      [ok(OPUS), ok(JULES)],
      answers({ "claude-sub": PAUSE, "google-sub": UNKNOWN }),
    );
    expect(chosen).toMatchObject({ route: null, idle: "quota_reserve" });
    expect(chosen.skipped[1]).toEqual({
      route: JULES,
      reason: `${UNKNOWN.reason}; not used past a reserve already reached`,
    });
  });

  it("GivenOnlyRoutingProblems_WhenChoosing_ThenNoRouteAndNoIdleReason", async () => {
    const chosen = await chooseRoute(
      [{ route: JULES, problem: "provider google-sub is off" }],
      answers({}),
    );
    expect(chosen).toEqual({
      route: null,
      skipped: [{ route: JULES, reason: "provider google-sub is off" }],
      idle: null,
    });
  });

  it("GivenAUsableFirstRoute_WhenChoosing_ThenLaterRoutesAreNotChecked", async () => {
    const check = vi.fn(answers({}));
    await chooseRoute([ok(OPUS), ok(PAID)], check);
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe("routeAvailability", () => {
  const all = providers({ "google-sub": true, openrouter: true });

  it("GivenAPausedSubscription_WhenAsked_ThenSkippedAtTheReserveWithItsPauseLevel", async () => {
    const a = await routeAvailability({ "claude-sub": "pause" }, all, async () => null)(OPUS);
    expect(a).toEqual({
      kind: "skip",
      reason: "claude-sub quota is at its pause level (80% used), keeping the reserve",
      idle: "quota_reserve",
    });
  });

  it("GivenNoLevelForASubscription_WhenAsked_ThenUnknown", async () => {
    const a = await routeAvailability({}, all, async () => null)(JULES);
    expect(a.kind).toBe("unknown");
  });

  it.each<QuotaLevel>(["ok", "warn"])("GivenASubscriptionAt%s_WhenAsked_ThenOk", async (level) => {
    const a = await routeAvailability({ "claude-sub": level }, all, async () => null)(OPUS);
    expect(a).toEqual({ kind: "ok" });
  });

  it("GivenAPaidRouteTheGateWouldRefuse_WhenAsked_ThenSkippedAtTheSpendCap", async () => {
    const a = await routeAvailability({}, all, async () => "no paid agent task: no price")(PAID);
    expect(a).toEqual({ kind: "skip", reason: "no paid agent task: no price", idle: "spend_cap" });
  });

  it("GivenAPaidRouteTheGateWouldAllow_WhenAsked_ThenOkAndNoQuotaIsRead", async () => {
    const a = await routeAvailability({ openrouter: "pause" }, all, async () => null)(PAID);
    expect(a).toEqual({ kind: "ok" });
  });
});

describe("dispatchQuotaLevel", () => {
  it.each<QuotaLevel>(["ok", "warn", "pause", "unknown"])(
    "GivenOnlyClaudeSubOn_WhenItIs%s_ThenThatLevelAsBefore",
    (level) => {
      expect(dispatchQuotaLevel({ "claude-sub": level }, providers({}))).toBe(level);
    },
  );

  it("GivenClaudeSubPausedAndGoogleSubWithRoom_WhenAsked_ThenNotPaused", () => {
    const p = providers({ "google-sub": true });
    expect(dispatchQuotaLevel({ "claude-sub": "pause", "google-sub": "ok" }, p)).toBe("ok");
  });

  it("GivenClaudeSubPausedAndGoogleSubUnknown_WhenAsked_ThenPaused", () => {
    const p = providers({ "google-sub": true });
    expect(dispatchQuotaLevel({ "claude-sub": "pause" }, p)).toBe("pause");
  });

  it("GivenClaudeSubPausedAndAPaidProviderOn_WhenAsked_ThenTheSpendGateDecidesPerTask", () => {
    const p = providers({ openrouter: true });
    expect(dispatchQuotaLevel({ "claude-sub": "pause" }, p)).toBe("ok");
  });

  it("GivenClaudeSubPausedAndGoogleSubAtWarn_WhenAsked_ThenWarnKeepsItsCap", () => {
    const p = providers({ "google-sub": true });
    expect(dispatchQuotaLevel({ "claude-sub": "pause", "google-sub": "warn" }, p)).toBe("warn");
  });

  it("GivenEveryProviderOff_WhenAsked_ThenUnknown", () => {
    expect(dispatchQuotaLevel({}, providers({ "claude-sub": false }))).toBe("unknown");
  });
});

describe("subscriptionLevel", () => {
  const reading = (usedPct: number, takenAt = NOW): QuotaReading => ({
    provider: "claude-sub",
    window: "5h",
    usedPct,
    resetsAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    source: "test",
    takenAt: takenAt.toISOString(),
    confidence: "high",
  });
  const claude = DEFAULT_ROUTING.providers["claude-sub"];

  it("GivenAFreshReadingAtThePauseLevel_WhenRead_ThenPause", () => {
    expect(subscriptionLevel("claude-sub", [reading(80)], claude, NOW)).toBe("pause");
  });

  it("GivenAReadingJustUnderThePauseLevel_WhenRead_ThenWarn", () => {
    expect(subscriptionLevel("claude-sub", [reading(79)], claude, NOW)).toBe("warn");
  });

  it("GivenAProjectPauseLevelOf60_WhenARead65_ThenPause", () => {
    const narrowed = { ...claude, warnPct: 50, pausePct: 60 };
    expect(subscriptionLevel("claude-sub", [reading(65)], narrowed, NOW)).toBe("pause");
  });

  it("GivenAReadingOlderThanSixHours_WhenRead_ThenUnknown", () => {
    const old = new Date(NOW.getTime() - 7 * 3_600_000);
    expect(subscriptionLevel("claude-sub", [reading(95, old)], claude, NOW)).toBe("unknown");
  });

  it("GivenOneFreshWindowWithRoomAndTheOtherUnread_WhenRead_ThenUnknown", () => {
    expect(subscriptionLevel("claude-sub", [reading(10)], claude, NOW)).toBe("unknown");
  });

  it("GivenNoReadings_WhenRead_ThenUnknown", () => {
    expect(subscriptionLevel("claude-sub", [], claude, NOW)).toBe("unknown");
  });
});
