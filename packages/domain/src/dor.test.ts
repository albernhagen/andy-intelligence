import { describe, expect, it } from "vitest";
import { checkDor, isHeld, type DorInput } from "./dor";

const feature: DorInput = {
  type: "feature",
  body: "Users can't see their tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list tickets by stage"],
  size: "S",
  sizeReason: "One screen, existing API",
};
const bug: DorInput = {
  ...feature,
  type: "bug",
  body: "1. Drop a card on Done. 2. Reload. Actual: it is back in Ready.",
  acceptanceCriteria: ["A dropped card stays in its new column after a reload."],
};
const chore: DorInput = {
  ...feature,
  type: "chore",
  body: "Bump Vite to 8.",
  acceptanceCriteria: ["CI is green", "no lockfile drift"],
};
const spike: DorInput = {
  ...feature,
  type: "spike",
  body: "Can the board render 1,000 cards without virtualising?",
  acceptanceCriteria: ["Render time at 1,000 cards", "Which list library, if any"],
};
const bare = { body: " ", acceptanceCriteria: [] as string[], size: null, sizeReason: null };

describe("checkDor", () => {
  it.each([
    ["feature", feature],
    ["bug", bug],
    ["chore", chore],
    ["spike", spike],
  ])("GivenACompleteTicketOfType%s_WhenChecked_ThenMetWithoutATier", (_, ticket) => {
    expect(checkDor(ticket, 0)).toEqual({ met: true, missing: [] });
  });

  it("GivenOpenQuestions_WhenChecked_ThenNotMet", () => {
    expect(checkDor(feature, 2)).toEqual({ met: false, missing: ["2 open question(s) answered"] });
  });

  it("GivenAFeatureWithACriterionWithoutShall_WhenChecked_ThenNotMet", () => {
    const result = checkDor({ ...feature, acceptanceCriteria: ["it works"] }, 0);
    expect(result.missing).toEqual(['1 acceptance criterion/criteria in EARS form ("… shall …")']);
  });

  it("GivenAFeatureWithShallAndAnySubject_WhenChecked_ThenAccepted", () => {
    const criteria = [
      "IF the token is invalid THEN THE SYSTEM SHALL return 401",
      "WHILE a run is in progress the board shall show a spinner",
      "When a card is dropped, the API shall persist its stage.",
    ];
    expect(checkDor({ ...feature, acceptanceCriteria: criteria }, 0).met).toBe(true);
  });

  it("GivenACriterionThatIsOnlyShall_WhenCheckedOnAFeature_ThenNotEars", () => {
    expect(checkDor({ ...feature, acceptanceCriteria: ["shall"] }, 0).met).toBe(false);
  });

  it("GivenABareFeature_WhenChecked_ThenListsEveryGap", () => {
    expect(checkDor({ type: "feature", ...bare }, 0).missing).toEqual([
      "problem/intent in the body",
      "acceptance criteria",
      "size",
      "size justification",
    ]);
  });

  it("GivenABareBug_WhenChecked_ThenAsksForReproStepsAndExpectedBehaviour", () => {
    expect(checkDor({ type: "bug", ...bare }, 0).missing).toEqual([
      "steps to reproduce and actual behaviour in the body",
      "expected behaviour as an acceptance criterion",
      "size",
      "size justification",
    ]);
  });

  it("GivenABugWithACriterionInAnyWording_WhenChecked_ThenMet", () => {
    expect(checkDor({ ...bug, acceptanceCriteria: ["cards stay put"] }, 0).met).toBe(true);
  });

  it("GivenABareChore_WhenChecked_ThenAsksForADoneWhenChecklist", () => {
    expect(checkDor({ type: "chore", ...bare }, 0).missing).toEqual([
      "problem/intent in the body",
      '"done when" checklist',
      "size",
      "size justification",
    ]);
  });

  it("GivenAChoreChecklistWithoutShall_WhenChecked_ThenMet", () => {
    expect(checkDor({ ...chore, acceptanceCriteria: ["tests pass"] }, 0).met).toBe(true);
  });

  it("GivenBlankCriteria_WhenChecked_ThenTheyDoNotCount", () => {
    expect(checkDor({ ...chore, acceptanceCriteria: ["  "] }, 0).missing).toEqual([
      '"done when" checklist',
    ]);
  });

  it("GivenNoType_WhenChecked_ThenTypeIsMissingAlongTheSharedChecks", () => {
    expect(checkDor({ ...feature, type: null }, 0)).toEqual({ met: false, missing: ["type"] });
    expect(checkDor({ type: null, ...bare }, 1).missing).toEqual([
      "type",
      "problem/intent in the body",
      "1 open question(s) answered",
      "size",
      "size justification",
    ]);
  });

  it("GivenAnEpicWithIntentOnly_WhenChecked_ThenMet", () => {
    const epic: DorInput = { type: "epic", ...bare, body: "Board" };
    expect(checkDor(epic, 0).met).toBe(true);
    expect(checkDor(epic, 1).met).toBe(false);
    expect(checkDor({ ...epic, body: "" }, 0).missing).toEqual(["problem/intent in the body"]);
  });
});

describe("held gaps (AI-75)", () => {
  const assumption = (over: object = {}) => ({
    status: "assumed" as const,
    demotedBy: "daily_cap" as const,
    cost: "direction" as const,
    ...over,
  });

  it("GivenACostlyGapACapDemoted_WhenChecked_ThenTheTicketIsNotReady", () => {
    const result = checkDor({ ...feature, refineAssumptions: [assumption()] as never }, 0);
    expect(result).toEqual({ met: false, missing: ["1 held question(s) asked or accepted"] });
  });

  it.each([
    ["reversible", { cost: "reversible" }],
    ["not demoted", { demotedBy: null }],
    ["accepted", { status: "accepted" }],
    ["promoted", { status: "promoted" }],
  ])("GivenADemotedGapThatIs%s_WhenChecked_ThenItDoesNotHold", (_, over) => {
    expect(isHeld(assumption(over) as never)).toBe(false);
    expect(checkDor({ ...feature, refineAssumptions: [assumption(over)] as never }, 0).met).toBe(
      true,
    );
  });

  it("GivenASpikeWithoutWhatTheFindingsMustAnswer_WhenChecked_ThenThatIsMissing", () => {
    expect(checkDor({ ...spike, acceptanceCriteria: [] }, 0).missing).toEqual([
      "what the findings must answer, as acceptance criteria",
    ]);
  });

  it("GivenASpikeWithoutASize_WhenChecked_ThenTheSizeIsMissingAsItsTimebox", () => {
    expect(checkDor({ ...spike, size: null }, 0).missing).toEqual(["size"]);
  });
});
