import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RELEASE_NOTE_MAX_CHARS,
  releaseNoteWords,
  firstSentence,
  parseReleaseNote,
} from "./release-note";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("parseReleaseNote", () => {
  it("GivenAFullBlock_WhenParsed_ThenAllThreeFieldsAndNoProblems", () => {
    const body = [
      "https://ai.andybernhagen.com/p/ai/t/AI-159",
      "",
      "What changed: Andy can read what merged on one page.",
      "How it works: The webhook stores the note on merge.",
      "Needs you: Mark the check as required.",
      "",
      "## Summary",
    ].join("\n");
    expect(parseReleaseNote(body)).toEqual({
      note: {
        whatChanged: "Andy can read what merged on one page.",
        howItWorks: "The webhook stores the note on merge.",
        needsYou: "Mark the check as required.",
      },
      problems: [],
    });
  });

  it("GivenBoldListLabelsAndAContinuationLine_WhenParsed_ThenTextIsJoined", () => {
    const body = [
      "- **What changed:** A page.",
      "- **How it works**: One route",
      "  and one tool.",
    ].join("\n");
    expect(parseReleaseNote(body).note).toEqual({
      whatChanged: "A page.",
      howItWorks: "One route and one tool.",
      needsYou: null,
    });
  });

  it("GivenNoBlock_WhenParsed_ThenNoNoteAndBothRequiredFieldsNamed", () => {
    const result = parseReleaseNote("## Summary\nSomething.");
    expect(result.note).toBeNull();
    expect(result.problems).toEqual([
      '"What changed:" is missing or empty.',
      '"How it works:" is missing or empty.',
    ]);
  });

  it("GivenAFieldOverItsCap_WhenParsed_ThenTheProblemSaysWhichAndByHowMuch", () => {
    const body = `What changed: ${words(31)}\nHow it works: ${words(45)}\nNeeds you: ${words(26)}`;
    const result = parseReleaseNote(body);
    expect(result.problems).toEqual([
      '"What changed:" is 31 words; the cap is 25 (6 over).',
      '"Needs you:" is 26 words; the cap is 25 (1 over).',
    ]);
    expect(result.note?.whatChanged).toBe(words(31));
  });

  it("GivenTheBlockOnlyInsideACodeFence_WhenParsed_ThenItDoesNotCount", () => {
    const body = "```\nWhat changed: x\nHow it works: y\n```";
    expect(parseReleaseNote(body).note).toBeNull();
  });

  it("GivenTheUnfilledPrTemplate_WhenParsed_ThenEveryFieldIsMissingOrEmpty", () => {
    const template = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../.github/pull_request_template.md"),
      "utf8",
    );
    expect(parseReleaseNote(template)).toEqual({
      note: null,
      problems: [
        '"What changed:" is missing or empty.',
        '"How it works:" is missing or empty.',
        '"Needs you:" is empty: remove it or fill it.',
      ],
    });
  });

  it("GivenTwoBlocks_WhenParsed_ThenTheFirstWins", () => {
    const body =
      "What changed: first\nHow it works: one\n\nWhat changed: second\nHow it works: two";
    expect(parseReleaseNote(body).note?.whatChanged).toBe("first");
  });

  it("GivenAnEmptyNeedsYou_WhenParsed_ThenAProblem", () => {
    const body = "What changed: a\nHow it works: b\nNeeds you:";
    expect(parseReleaseNote(body).problems).toEqual([
      '"Needs you:" is empty: remove it or fill it.',
    ]);
  });

  it("GivenAHugeField_WhenParsed_ThenStoredTextIsCappedInCharacters", () => {
    const body = `What changed: ${"x".repeat(5000)}\nHow it works: b`;
    expect(parseReleaseNote(body).note?.whatChanged).toHaveLength(RELEASE_NOTE_MAX_CHARS);
  });

  it("GivenAHeadingRightAfterAField_WhenParsed_ThenTheFieldStopsThere", () => {
    const body = "What changed: a\n## Summary\nmore\nHow it works: b";
    expect(parseReleaseNote(body).note?.whatChanged).toBe("a");
  });
});

describe("firstSentence", () => {
  it("GivenALinkHeadingAndProse_WhenRead_ThenTheFirstProseSentence", () => {
    const body =
      "https://ai.andybernhagen.com/p/ai/t/AI-1\n\n## Summary\n\nAdds **a page**. Then more.";
    expect(firstSentence(body)).toBe("Adds a page.");
  });

  it("GivenALongSentence_WhenRead_ThenCutToTheCapWithAnEllipsis", () => {
    expect(firstSentence(words(30), 25)).toBe(`${words(25)}…`);
  });

  it("GivenNoProse_WhenRead_ThenEmpty", () => {
    expect(firstSentence("## Summary\n<!-- x -->\n```\ncode\n```")).toBe("");
  });

  it("GivenAListItem_WhenRead_ThenTheMarkerIsDropped", () => {
    expect(firstSentence("## Summary\n- Ships the store. Also tests.")).toBe("Ships the store.");
  });
});

describe("releaseNoteWords", () => {
  it("GivenExtraWhitespace_WhenCounted_ThenOnlyWords", () => {
    expect(releaseNoteWords("  a  b\n c ")).toBe(3);
  });
});
