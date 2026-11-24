import { describe, expect, it } from "vitest";
import {
  BRIEF_PAGES,
  EMPTY_DRAFT,
  draftFrom,
  loadOpenedBrief,
  missingOn,
  toAnswers,
} from "./brief-draft";

const full = {
  ...EMPTY_DRAFT,
  idea: "Runs.",
  problem: "Hidden.",
  users: "Andy.",
  business: "None.",
  vision: "Totals.",
  goals: "One\n\n Two ",
  stack: "TS.",
  cloud: "GCP.",
  environments: "Dev.",
  constraints: "Cheap.",
  qualityBar: "Tests.",
};

describe("brief draft", () => {
  it("GivenEveryRequiredAnswer_WhenConverted_ThenListsAreOneItemPerLine", () => {
    expect(toAnswers("Trail log", full)).toMatchObject({
      projectName: "Trail log",
      goals: ["One", "Two"],
      nonGoals: [],
      openQuestions: [],
    });
  });

  it("GivenNoDesignAnswer_WhenConverted_ThenDesignIsLeftOut", () => {
    expect(toAnswers("Trail log", full)).not.toHaveProperty("design");
  });

  it("GivenAMissingRequiredAnswer_WhenConverted_ThenNull", () => {
    expect(toAnswers("Trail log", { ...full, vision: " " })).toBeNull();
  });

  it("GivenTheFirstPageEmpty_WhenChecked_ThenItsFourQuestionsAreMissing", () => {
    expect(missingOn(BRIEF_PAGES[0]!, EMPTY_DRAFT).map((q) => q.field)).toEqual([
      "idea",
      "problem",
      "users",
      "business",
    ]);
  });

  it("GivenEveryPage_WhenListed_ThenTheyAskEverySchemaAnswerOnce", () => {
    const fields = BRIEF_PAGES.flatMap((p) => p.questions.map((q) => q.field)).sort();
    expect(fields).toEqual(Object.keys(EMPTY_DRAFT).sort());
  });

  it("GivenDiscoveryAnswers_WhenADraftStarts_ThenTheyFillItsFields", () => {
    expect(draftFrom({ idea: "Runs." })).toEqual({ ...EMPTY_DRAFT, idea: "Runs." });
  });
});

describe("opened brief link", () => {
  it("GivenAStoredLinkThatIsNotGitHubHttps_WhenLoaded_ThenIgnored", () => {
    localStorage.setItem("brief-pr:x", JSON.stringify({ number: 1, url: "javascript:alert(1)" }));
    expect(loadOpenedBrief("x")).toBeNull();
  });

  it("GivenAGitHubLink_WhenLoaded_ThenKept", () => {
    const url = "https://github.com/o/r/pull/1";
    localStorage.setItem("brief-pr:y", JSON.stringify({ number: 1, url }));
    expect(loadOpenedBrief("y")).toEqual({ number: 1, url });
  });
});
