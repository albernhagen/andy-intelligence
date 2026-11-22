import { describe, expect, it } from "vitest";
import {
  DIGEST_SUMMARY_LIMITS,
  DigestSummary,
  DigestSummaryOutput,
  DigestSummaryPeriod,
  claimedDigestSummary,
} from "./digest-summary";

const line = {
  heading: "M4: Roadmap",
  epicKey: null,
  text: "The digest has a summary.",
  refs: { tickets: ["AI-323"] },
};
const output = { summary: "Andy can read it.", summaryRefs: { prs: [1] }, lines: [line] };

describe("DigestSummaryOutput", () => {
  it("GivenRefsWithOneListLeftOut_WhenParsed_ThenTheOtherDefaultsToEmpty", () => {
    const parsed = DigestSummaryOutput.parse(output);
    expect(parsed.summaryRefs).toEqual({ tickets: [], prs: [1] });
    expect(parsed.lines[0]?.refs).toEqual({ tickets: ["AI-323"], prs: [] });
  });

  it("GivenALineCitingNothing_WhenParsed_ThenRefused", () => {
    const bad = { ...output, lines: [{ ...line, refs: { tickets: [], prs: [] } }] };
    expect(DigestSummaryOutput.safeParse(bad).success).toBe(false);
  });

  it("GivenASummaryOverTheWordCap_WhenParsed_ThenRefused", () => {
    const words = Array.from({ length: DIGEST_SUMMARY_LIMITS.summaryWords + 1 }, () => "a");
    const bad = { ...output, summary: words.join(" ") };
    expect(DigestSummaryOutput.safeParse(bad).success).toBe(false);
    const ok = { ...output, summary: words.slice(1).join(" ") };
    expect(DigestSummaryOutput.safeParse(ok).success).toBe(true);
  });

  it("GivenMoreLinesOrRefsThanTheCaps_WhenParsed_ThenRefused", () => {
    const lines = Array.from({ length: DIGEST_SUMMARY_LIMITS.lines + 1 }, () => line);
    expect(DigestSummaryOutput.safeParse({ ...output, lines }).success).toBe(false);
    const refs = {
      tickets: ["AI-1", "AI-2", "AI-3", "AI-4", "AI-5", "AI-6"],
      prs: [1, 2, 3, 4, 5],
    };
    expect(DigestSummaryOutput.safeParse({ ...output, summaryRefs: refs }).success).toBe(false);
  });
});

describe("DigestSummary", () => {
  const period = {
    id: "2026-11-21",
    timeZone: "America/Denver",
    from: "2026-11-21T07:00:00.000Z",
    to: "2026-11-22T07:00:00.000Z",
  };
  const now = "2026-11-22T15:00:00.000Z";

  it("GivenBoundsThatAreNotTheDayInItsZone_WhenParsed_ThenRefused", () => {
    expect(DigestSummaryPeriod.safeParse(period).success).toBe(true);
    const bad = [
      { ...period, from: period.to, to: period.from },
      { ...period, id: "2026-11-22" },
      { ...period, to: "2026-11-23T07:00:00.000Z" },
      { ...period, timeZone: "Mars/Olympus" },
      // 24 hours, but 13:00 to 13:00 Denver: half of two days.
      { ...period, from: "2026-11-21T20:00:00.000Z", to: "2026-11-22T20:00:00.000Z" },
      // Starts at midnight but ends an hour into the next day.
      { ...period, to: "2026-11-22T08:00:00.000Z" },
    ];
    for (const p of bad)
      expect(DigestSummaryPeriod.safeParse(p).success, JSON.stringify(p)).toBe(false);
    expect(() => claimedDigestSummary("ai", bad[0]!, now)).toThrow();
  });

  it("GivenTheDayClocksSpringForward_WhenParsed_ThenItsTwentyThreeHoursAreAccepted", () => {
    const short = {
      id: "2026-03-08",
      timeZone: "America/Denver",
      from: "2026-03-08T07:00:00.000Z",
      to: "2026-03-09T06:00:00.000Z",
    };
    expect(DigestSummaryPeriod.safeParse(short).success).toBe(true);
  });

  it("GivenAReadyStatusWithoutOutput_WhenParsed_ThenRefused", () => {
    const writing = claimedDigestSummary("ai", period, now);
    expect(DigestSummary.safeParse({ ...writing, status: "ready" }).success).toBe(false);
    expect(DigestSummary.safeParse({ ...writing, status: "failed" }).success).toBe(false);
  });
});
