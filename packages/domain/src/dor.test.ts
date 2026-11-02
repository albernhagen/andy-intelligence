import { describe, expect, it } from "vitest";
import { checkDor, type DorInput } from "./dor";

const ready: DorInput = {
  type: "story",
  body: "Users can't see their tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets by stage"],
  size: "S",
  sizeReason: "One screen, existing API",
  tier: "strong",
};

describe("checkDor", () => {
  it("GivenACompleteStory_WhenChecked_ThenMet", () => {
    expect(checkDor(ready, 0)).toEqual({ met: true, missing: [] });
  });

  it("GivenOpenQuestions_WhenChecked_ThenNotMet", () => {
    expect(checkDor(ready, 2)).toEqual({ met: false, missing: ["2 open question(s) answered"] });
  });

  it("GivenNonEarsCriteria_WhenChecked_ThenNotMet", () => {
    const result = checkDor({ ...ready, acceptanceCriteria: ["it works"] }, 0);
    expect(result.missing).toEqual(["1 acceptance criterion/criteria in EARS form"]);
  });

  it("GivenOtherEarsPatterns_WhenChecked_ThenAccepted", () => {
    const criteria = [
      "IF the token is invalid THEN THE SYSTEM SHALL return 401",
      "WHILE a run is in progress the system shall show a spinner",
    ];
    expect(checkDor({ ...ready, acceptanceCriteria: criteria }, 0).met).toBe(true);
  });

  it("GivenABareStory_WhenChecked_ThenListsEveryGap", () => {
    const bare: DorInput = {
      type: "task",
      body: " ",
      acceptanceCriteria: [],
      size: null,
      sizeReason: null,
      tier: null,
    };
    expect(checkDor(bare, 0).missing).toEqual([
      "problem/intent in the body",
      "acceptance criteria",
      "size",
      "size justification",
      "tier",
    ]);
  });

  it("GivenAnEpicWithIntentOnly_WhenChecked_ThenMet", () => {
    const epic: DorInput = {
      type: "epic",
      body: "Board",
      acceptanceCriteria: [],
      size: null,
      sizeReason: null,
      tier: null,
    };
    expect(checkDor(epic, 0).met).toBe(true);
    expect(checkDor(epic, 1).met).toBe(false);
  });
});
