import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_RUNS_AT_WARN,
  MAX_ACTIVE_RUNS_GLOBAL,
  MAX_PRS_WAITING_PER_PROJECT,
  isInFlight,
  mayDispatch,
  waitsForSlot,
  type DispatchCounts,
} from "./dispatch-caps";

const project = { paused: false, runsAtOnce: 2 };
const idle: DispatchCounts = { projectActive: 0, globalActive: 0, prsWaiting: 0, quotaLevel: "ok" };

describe("mayDispatch", () => {
  it("GivenRoomUnderEveryCap_WhenAsked_ThenStart", () => {
    expect(mayDispatch(project, idle)).toBe("start");
  });

  it("GivenPaused_WhenAsked_ThenPausedWinsOverEveryCap", () => {
    expect(
      mayDispatch(
        { ...project, paused: true },
        {
          projectActive: 9,
          globalActive: 9,
          prsWaiting: 9,
          quotaLevel: "pause",
        },
      ),
    ).toBe("paused");
  });

  it("GivenOneRunBelowTheDial_WhenAsked_ThenStart", () => {
    expect(mayDispatch(project, { ...idle, projectActive: 1, globalActive: 1 })).toBe("start");
  });

  it("GivenRunsEqualToTheDial_WhenAsked_ThenProjectCap", () => {
    expect(mayDispatch(project, { ...idle, projectActive: 2, globalActive: 2 })).toBe(
      "project_cap",
    );
  });

  it("GivenRunsEqualToTheGlobalCap_WhenAsked_ThenGlobalCap", () => {
    expect(mayDispatch(project, { ...idle, globalActive: MAX_ACTIVE_RUNS_GLOBAL })).toBe(
      "global_cap",
    );
  });

  it("GivenPrsWaitingAtTheCap_WhenAsked_ThenPrsWaitingCap", () => {
    expect(mayDispatch(project, { ...idle, prsWaiting: MAX_PRS_WAITING_PER_PROJECT })).toBe(
      "prs_waiting_cap",
    );
  });

  it("GivenPrsWaitingPlusRunsInFlightAtTheCap_WhenAsked_ThenPrsWaitingCap", () => {
    expect(
      mayDispatch(project, {
        ...idle,
        projectActive: 1,
        globalActive: 1,
        prsWaiting: MAX_PRS_WAITING_PER_PROJECT - 1,
      }),
    ).toBe("prs_waiting_cap");
  });

  it("GivenPrsWaitingOneBelowTheCap_WhenAsked_ThenStart", () => {
    expect(mayDispatch(project, { ...idle, prsWaiting: MAX_PRS_WAITING_PER_PROJECT - 1 })).toBe(
      "start",
    );
  });

  it("GivenQuotaAtThePauseLevel_WhenAsked_ThenQuotaReserve", () => {
    expect(mayDispatch(project, { ...idle, quotaLevel: "pause" })).toBe("quota_reserve");
  });

  it.each(["ok", "warn", "unknown"] as const)(
    "GivenQuotaLevel%sAndNothingInFlight_WhenAsked_ThenStart",
    (quotaLevel) => {
      expect(mayDispatch(project, { ...idle, quotaLevel })).toBe("start");
    },
  );

  it("GivenQuotaAtWarnAndOneRunInFlightAnywhere_WhenAsked_ThenQuotaWarn", () => {
    expect(MAX_ACTIVE_RUNS_AT_WARN).toBe(1);
    // The run in flight is in another project: the project's own dial has room.
    expect(mayDispatch(project, { ...idle, quotaLevel: "warn", globalActive: 1 })).toBe(
      "quota_warn",
    );
  });

  it.each(["ok", "unknown"] as const)(
    "GivenQuotaLevel%sAndRunsInFlightBelowTheGlobalCap_WhenAsked_ThenStartAsToday",
    (quotaLevel) => {
      const counts = { ...idle, quotaLevel, globalActive: MAX_ACTIVE_RUNS_GLOBAL - 1 };
      expect(mayDispatch(project, counts)).toBe("start");
    },
  );

  it("GivenQuotaAtPauseAndRunsInFlight_WhenAsked_ThenQuotaReserveAsToday", () => {
    expect(mayDispatch(project, { ...idle, quotaLevel: "pause", globalActive: 1 })).toBe(
      "quota_reserve",
    );
  });

  it("GivenQuotaAtWarnAndTheProjectDialFull_WhenAsked_ThenTheProjectCapIsNamedFirst", () => {
    const counts = { ...idle, quotaLevel: "warn" as const, projectActive: 2, globalActive: 2 };
    expect(mayDispatch(project, counts)).toBe("project_cap");
  });
});

describe("waitsForSlot", () => {
  it("GivenEachDecision_WhenAsked_ThenOnlyTheCapsAcrossProjectsWaitForASlot", () => {
    expect(waitsForSlot("global_cap")).toBe(true);
    expect(waitsForSlot("quota_warn")).toBe(true);
    for (const d of ["paused", "project_cap", "quota_reserve", "started", "nothing_ready"] as const)
      expect(waitsForSlot(d)).toBe(false);
    expect(waitsForSlot(undefined)).toBe(false);
  });
});

describe("isInFlight", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");

  it("GivenRunsOfEveryStatusAndDeadline_WhenAsked_ThenOnlyQueuedOrRunningBeforeTheirDeadline", () => {
    expect(isInFlight({ status: "queued", deadline: null }, now)).toBe(true);
    expect(isInFlight({ status: "running", deadline: "2026-11-09T13:00:00.000Z" }, now)).toBe(true);
    expect(isInFlight({ status: "running", deadline: "2026-11-09T11:00:00.000Z" }, now)).toBe(
      false,
    );
    expect(isInFlight({ status: "succeeded", deadline: null }, now)).toBe(false);
  });
});
