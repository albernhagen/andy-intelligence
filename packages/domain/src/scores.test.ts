import { describe, expect, it } from "vitest";
import { scoreMarkers, sortByStartScore, startScore, type Scored } from "./scores";

const scored = (
  rank: string,
  size: Scored["size"],
  risk: Scored["risk"],
  confidence: Scored["confidence"],
) => ({ rank, size, risk, confidence });
const order = (list: ReturnType<typeof scored>[]) => sortByStartScore(list).map((t) => t.rank);

describe("startScore", () => {
  it.each([
    [scored("1", "S", "low", "high"), "S · low risk · confident"],
    [scored("1", "M", "medium", "medium"), "M · medium risk · fairly confident"],
    [scored("1", "L", "high", "low"), "L · high risk · not confident"],
    [scored("1", "S", null, null), "S"],
    [scored("1", null, "high", null), "high risk"],
    [scored("1", null, null, null), ""],
  ] as const)("GivenScores%#_WhenLabelled_ThenTheLabelNamesOnlyWhatIsSet", (ticket, label) => {
    expect(startScore(ticket)).toBe(label);
  });

  it("GivenPartialScores_WhenMarkersAreRead_ThenOnlySetOnesAppear", () => {
    expect(scoreMarkers(scored("1", "S", null, "low"))).toEqual({
      size: "S",
      confidence: "not confident",
    });
  });
});

describe("sortByStartScore", () => {
  it("GivenDifferentSizes_WhenSorted_ThenSmallestFirstEvenWithWorseRisk", () => {
    expect(order([scored("1", "L", "low", "high"), scored("2", "S", "high", "low")])).toEqual([
      "2",
      "1",
    ]);
  });

  it("GivenTheSameSize_WhenSorted_ThenLowestRiskThenHighestConfidence", () => {
    expect(
      order([
        scored("1", "S", "medium", "high"),
        scored("2", "S", "low", "low"),
        scored("3", "S", "low", "high"),
      ]),
    ).toEqual(["3", "2", "1"]);
  });

  it("GivenMissingScores_WhenSorted_ThenTheySortAfterRealOnes", () => {
    expect(
      order([
        scored("1", null, "low", "high"),
        scored("2", "L", null, "high"),
        scored("3", "L", "high", "high"),
      ]),
    ).toEqual(["3", "2", "1"]);
  });

  it("GivenTies_WhenSorted_ThenBoardRankDecidesWhateverTheInputOrder", () => {
    expect(order([scored("2", "S", "low", "high"), scored("1", "S", "low", "high")])).toEqual([
      "1",
      "2",
    ]);
  });

  it("GivenAList_WhenSorted_ThenTheInputAndItsRanksStayAsTheyWere", () => {
    const input = [scored("1", "L", null, null), scored("2", "S", null, null)];
    const before = structuredClone(input);
    sortByStartScore(input);
    expect(input).toEqual(before);
  });
});
