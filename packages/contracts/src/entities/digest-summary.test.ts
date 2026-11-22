import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIGEST_SUMMARY_LIMITS,
  DigestSummary,
  DigestSummaryOutput,
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

  it("GivenAReadyStatusWithoutOutput_WhenParsed_ThenRefused", () => {
    const writing = claimedDigestSummary("ai", period, now);
    expect(DigestSummary.safeParse({ ...writing, status: "ready" }).success).toBe(false);
    expect(DigestSummary.safeParse({ ...writing, status: "failed" }).success).toBe(false);
  });
});

// The schema the executor hands the summarize agent (`--json-schema`, AI-323 PR 2) must hold
// the same shape and caps as DigestSummaryOutput, the domain's check.
describe("summarize.schema.json", () => {
  const schema = JSON.parse(
    readFileSync(
      new URL("../../../../platform/procedures/summarize.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const L = DIGEST_SUMMARY_LIMITS;

  it("GivenTheAgentSchemaFile_WhenComparedWithTheLimits_ThenTheyMatch", () => {
    const line = schema.properties.lines.items;
    expect(schema.required).toEqual(["summary", "summaryRefs", "lines"]);
    expect(schema.properties.summary.maxLength).toBe(L.summaryChars);
    expect(schema.properties.lines.maxItems).toBe(L.lines);
    expect(line.properties.text.maxLength).toBe(L.lineChars);
    expect(line.properties.heading.maxLength).toBe(L.headingChars);
    expect(schema.properties.summaryRefs.properties.tickets.maxItems).toBe(L.refs);
    expect(line.properties.refs.properties.prs.maxItems).toBe(L.refs);
  });

  it("GivenAnAnswerTheAgentSchemaAllows_WhenParsedHere_ThenItIsAccepted", () => {
    const answer = {
      summary: "Andy can read it.",
      summaryRefs: { tickets: ["AI-323"], prs: [] },
      lines: [{ heading: "M4", epicKey: null, text: "Done.", refs: { tickets: [], prs: [349] } }],
    };
    expect(DigestSummaryOutput.parse(answer)).toEqual(answer);
  });
});
