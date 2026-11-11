import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import {
  IDLE_AFTER_MS,
  IDLE_POLL_MS,
  isUnreachable,
  LIVE_POLL_MS,
  LiveUpdates,
  pollInterval,
} from "./live";

const at = (over: Partial<Parameters<typeof pollInterval>[0]> = {}) =>
  pollInterval({ pace: "live", inFlight: false, idle: false, failures: 0, ...over });

describe("pollInterval (AI-9)", () => {
  it("GivenALiveViewAndAndyActive_WhenComputed_ThenPollsEveryFiveSeconds", () => {
    expect(at()).toBe(5_000);
    expect(LIVE_POLL_MS).toBe(5_000);
  });

  it("GivenAndyIdleAndNothingInFlight_WhenComputed_ThenSlowsToSixtySeconds", () => {
    expect(at({ idle: true })).toBe(60_000);
  });

  it("GivenAndyIdleButARunInFlight_WhenComputed_ThenStaysAtFiveSeconds", () => {
    expect(at({ idle: true, inFlight: true })).toBe(5_000);
  });

  it("GivenASlowView_WhenComputed_ThenPollsEverySixtySecondsEvenWithARunInFlight", () => {
    expect(at({ pace: "slow" })).toBe(60_000);
    expect(at({ pace: "slow", inFlight: true })).toBe(60_000);
  });

  it("GivenConsecutiveFailures_WhenComputed_ThenBacksOffByDoublingUpToSixtySeconds", () => {
    expect([1, 2, 3, 4, 10, 1000].map((failures) => at({ failures }))).toEqual([
      10_000, 20_000, 40_000, 60_000, 60_000, 60_000,
    ]);
  });

  it("GivenAnyInput_WhenComputed_ThenTheIntervalStaysBetweenTheFloorAndTheCap", () => {
    for (const pace of ["live", "slow"] as const)
      for (const idle of [true, false])
        for (const inFlight of [true, false])
          for (const failures of [-5, 0, 1, 7, Number.MAX_SAFE_INTEGER]) {
            const ms = pollInterval({ pace, idle, inFlight, failures });
            expect(ms).toBeGreaterThanOrEqual(LIVE_POLL_MS);
            expect(ms).toBeLessThanOrEqual(IDLE_POLL_MS);
          }
  });
});

describe("isUnreachable", () => {
  it("GivenANetworkErrorOrA5xx_WhenChecked_ThenUpdatesAreDelayed", () => {
    expect(isUnreachable(new TypeError("Failed to fetch"))).toBe(true);
    expect(isUnreachable(new ApiError(503, "unavailable"))).toBe(true);
  });

  it("GivenA4xx_WhenChecked_ThenTheApiWasReached", () => {
    expect(isUnreachable(new ApiError(404, "not found"))).toBe(false);
    expect(isUnreachable(new ApiError(409, "conflict"))).toBe(false);
  });
});

describe("LiveUpdates", () => {
  function setup() {
    let now = 1_000_000;
    const queryClient = new QueryClient();
    const refetch = vi.spyOn(queryClient, "refetchQueries").mockResolvedValue();
    const live = new LiveUpdates(queryClient, () => now);
    return { live, refetch, advance: (ms: number) => (now += ms) };
  }

  it("GivenNoInputForFiveMinutes_WhenAsked_ThenItIsIdleAndPollsSlowly", () => {
    const { live, advance } = setup();
    advance(IDLE_AFTER_MS - 1);
    expect(live.interval("live")).toBe(LIVE_POLL_MS);
    advance(1);
    expect(live.isIdle()).toBe(true);
    expect(live.interval("live")).toBe(IDLE_POLL_MS);
  });

  it("GivenAndyIdle_WhenHeMovesTheMouse_ThenTheLiveViewsOnScreenRefetchAtOnce", () => {
    const { live, refetch, advance } = setup();
    live.noteInput();
    expect(refetch).not.toHaveBeenCalled();
    advance(IDLE_AFTER_MS);
    live.noteInput();
    expect(refetch).toHaveBeenCalledTimes(1);
    const [filters, options] = refetch.mock.calls[0]!;
    expect(filters?.type).toBe("active");
    expect(options).toEqual({ cancelRefetch: false });
    const query = (meta?: Record<string, unknown>) => ({ meta }) as never;
    expect(filters?.predicate?.(query({ live: true }))).toBe(true);
    expect(filters?.predicate?.(query(undefined))).toBe(false);
    expect(live.interval("live")).toBe(LIVE_POLL_MS);
  });

  it("GivenAndyIdle_WhenTheTabBecomesVisible_ThenHeIsActiveWithoutASecondRefetch", () => {
    const { live, refetch, advance } = setup();
    advance(IDLE_AFTER_MS * 2);
    live.noteVisible();
    expect(refetch).not.toHaveBeenCalled();
    expect(live.isIdle()).toBe(false);
  });

  it("GivenSeveralViewsFailingInOneRound_WhenCounted_ThenItIsOneFailure", () => {
    const { live, advance } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    live.noteResult(false);
    live.noteResult(false);
    live.noteResult(false);
    expect(live.interval("live")).toBe(10_000);
    advance(10_000);
    live.noteResult(false);
    live.noteResult(false);
    expect(live.interval("live")).toBe(20_000);
  });

  it("GivenFailedRounds_WhenOneReachesTheApi_ThenDelayedClearsAndBackoffResets", () => {
    const { live, advance } = setup();
    const changes = vi.fn();
    live.subscribe(changes);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    live.noteResult(false);
    advance(10_000);
    live.noteResult(false);
    expect(live.delayed()).toBe(true);
    expect(live.interval("live")).toBe(20_000);
    live.noteResult(true);
    live.noteResult(true);
    expect(live.delayed()).toBe(false);
    expect(live.interval("live")).toBe(LIVE_POLL_MS);
    expect(changes).toHaveBeenCalledTimes(3);
  });
});
