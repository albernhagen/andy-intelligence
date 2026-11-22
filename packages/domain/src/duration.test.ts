import { describe, expect, it } from "vitest";
import { durationText } from "./duration";

/** AI-329: durations read as words; nothing over 90 minutes shows in minutes. */
describe("durationText", () => {
  it.each([
    [0, "0 min"],
    [1, "1 min"],
    [89, "89 min"],
    [89.9, "89 min"],
    [-3, "0 min"],
  ])("GivenUnder90Minutes_WhenFormatted_ThenMinutes (%s)", (minutes, text) => {
    expect(durationText(minutes)).toBe(text);
  });

  it.each([
    [90, "1 hour"],
    [120, "2 hours"],
    [47 * 60 + 59, "47 hours"],
  ])("Given90MinutesTo48Hours_WhenFormatted_ThenHours (%s)", (minutes, text) => {
    expect(durationText(minutes)).toBe(text);
  });

  it.each([
    [48 * 60, "2 days"],
    [25239, "17 days"],
  ])("Given48HoursOrMore_WhenFormatted_ThenDays (%s)", (minutes, text) => {
    expect(durationText(minutes)).toBe(text);
  });
});
