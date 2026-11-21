import { describe, expect, it } from "vitest";
import { parseLid, parsePower, parseSleeps, timerLateness, verdict } from "./host-check.mjs";

const NOW = Date.parse("2026-11-20T12:00:00-07:00");
const awake = {
  lidClosed: false,
  lidSleeps: true,
  onBattery: false,
  percent: 100,
  sleeps: [],
  load1: 4,
  cores: 14,
  lateMs: 2,
  now: NOW,
};

describe("host-check parsers", () => {
  it("GivenClosedLidWithoutDisplay_WhenParsed_ThenClosedAndSleeps", () => {
    const out = '  |   "AppleClamshellCausesSleep" = Yes\n  |   "AppleClamshellState" = Yes\n';
    expect(parseLid(out)).toEqual({ lidClosed: true, lidSleeps: true });
  });

  it("GivenClamshellModeWithDisplay_WhenParsed_ThenClosedButAwake", () => {
    const out = '"AppleClamshellCausesSleep" = No\n"AppleClamshellState" = Yes\n';
    expect(parseLid(out)).toEqual({ lidClosed: true, lidSleeps: false });
  });

  it("GivenDesktopMac_WhenParsed_ThenNoLid", () => {
    expect(parseLid("")).toEqual({ lidClosed: null, lidSleeps: true });
  });

  it("GivenBatteryOutput_WhenParsed_ThenOnBatteryWithPercent", () => {
    const out = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t54%; discharging;";
    expect(parsePower(out)).toEqual({ onBattery: true, percent: 54 });
  });

  it("GivenPmsetLog_WhenParsed_ThenOnlySleepsSinceCutoff", () => {
    const log = [
      "2026-11-19 09:00:00 -0700 Sleep               \tEntering Sleep state due to 'Clamshell Sleep'",
      "2026-11-20 11:30:00 -0700 Sleep               \tEntering Sleep state due to 'Clamshell Sleep':Using AC",
      "2026-11-20 11:31:00 -0700 Wake                \tWake from Deep Idle",
      "2026-11-20 11:32:00 -0700 Wake Requests       \t[process=dasd request=SleepService]",
    ].join("\n");
    const sleeps = parseSleeps(log, NOW - 86_400_000);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toMatchObject({
      at: Date.parse("2026-11-20T11:30:00-07:00"),
      what: expect.stringMatching(/Clamshell/),
    });
  });
});

describe("host-check verdict", () => {
  it("GivenAwakeIdleHost_WhenJudged_ThenOk", () => {
    expect(verdict(awake)).toMatchObject({ ok: true, verdict: expect.stringMatching(/^OK/) });
  });

  it("GivenLidClosedWithoutDisplay_WhenJudged_ThenHostProblem", () => {
    expect(verdict({ ...awake, lidClosed: true }).verdict).toMatch(/HOST PROBLEM: lid is closed/);
  });

  it("GivenClamshellModeWithDisplay_WhenJudged_ThenOk", () => {
    expect(verdict({ ...awake, lidClosed: true, lidSleeps: false }).ok).toBe(true);
  });

  it("GivenSleepInLastHour_WhenJudged_ThenBlamesHostNotCode", () => {
    const sleeps = [{ at: NOW - 600_000, what: "Clamshell Sleep" }];
    expect(verdict({ ...awake, sleeps }).verdict).toMatch(/slept 1 time\(s\) in the last hour/);
  });

  it("GivenOverloadAndLateTimers_WhenJudged_ThenBothReported", () => {
    const v = verdict({ ...awake, load1: 60, lateMs: 400 });
    expect(v.verdict).toMatch(/overloaded: load 60.0 on 14 cores/);
    expect(v.verdict).toMatch(/400 ms late/);
  });

  it("GivenOnBattery_WhenJudged_ThenHostProblem", () => {
    expect(verdict({ ...awake, onBattery: true, percent: 40 }).verdict).toMatch(
      /on battery \(40%\)/,
    );
  });

  it("GivenRealTimers_WhenMeasured_ThenNonNegativeWholeMs", async () => {
    const late = await timerLateness(2, 5);
    expect(Number.isInteger(late) && late >= 0).toBe(true);
  });
});
