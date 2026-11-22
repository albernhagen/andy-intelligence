import { describe, expect, it } from "vitest";
import { count, dateOnly, dateTime, elapsed, timeOfDay } from "@/lib/format";
import { settingLabel, settingValue } from "@/lib/settings-labels";

/** AI-329: times, durations, counts and setting names read as words. */

const ISO = "2026-11-04T14:50:07.000Z";
const SECONDS = /\d:\d\d:\d\d/;

describe("format", () => {
  it("GivenATime_WhenFormatted_ThenNoSeconds", () => {
    expect(timeOfDay(ISO)).toMatch(/^\d{1,2}:\d\d [AP]M$/);
    expect(dateTime(ISO, new Date(ISO))).toMatch(/^Nov \d{1,2}, \d{1,2}:\d\d [AP]M$/);
    expect(dateOnly(ISO)).toMatch(/^Nov \d{1,2}, 2026$/);
    for (const text of [timeOfDay(ISO), dateTime(ISO, new Date(ISO)), dateOnly(ISO)]) {
      expect(text).not.toMatch(SECONDS);
    }
  });

  it("GivenADateFromAnotherYear_WhenFormatted_ThenTheYearShows", () => {
    const now = new Date("2026-11-22T12:00:00Z");
    expect(dateTime("2025-11-04T14:50:07.000Z", now)).toMatch(
      /^Nov \d{1,2}, 2025, \d{1,2}:\d\d [AP]M$/,
    );
    expect(dateTime("2026-11-04T14:50:07.000Z", now)).not.toContain("2026");
  });

  it("GivenALargeNumber_WhenCounted_ThenThousandsSeparators", () => {
    expect(count(5_000_000)).toBe("5,000,000");
  });

  it("GivenALongDuration_WhenElapsed_ThenWordsNotMinutes", () => {
    expect(elapsed(25_239 * 60_000)).toBe("17 days");
  });
});

describe("settings labels", () => {
  it("GivenAFieldName_WhenLabelled_ThenTheSettingsPageName", () => {
    expect(settingLabel("autoRefine")).toBe("Auto-refine");
    expect(settingLabel("runsAtOnce")).toBe("Agent tasks at once");
    expect(settingLabel("somethingNew")).toBe("somethingNew");
  });

  it("GivenValues_WhenShown_ThenOnOffNumbersAndNotSet", () => {
    expect(settingValue(true)).toBe("on");
    expect(settingValue(false)).toBe("off");
    expect(settingValue(1500)).toBe("1,500");
    expect(settingValue(null)).toBe("not set");
    expect(settingValue("epics")).toBe("epics");
  });
});
