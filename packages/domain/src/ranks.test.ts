import { compareRanks, rankFor } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { rankBetween } from "./ranks";

const between = (a: string | null, b: string | null) => {
  const r = rankBetween(a, b);
  if (a !== null) expect(r > a).toBe(true);
  if (b !== null) expect(r < b).toBe(true);
  return r;
};

describe("rankBetween", () => {
  it("GivenTwoNewTicketRanks_WhenPlacedBetween_ThenTheRankSortsBetweenThem", () => {
    expect(between(rankFor(28), rankFor(29))).toBe("0000000028.5");
    expect(between(rankFor(20), rankFor(30))).toBe("0000000020.5");
  });

  it("GivenATopCard_WhenPlacedAboveIt_ThenTheRankSortsFirst", () => {
    expect(between(null, rankFor(28))).toBe("0000000027.5");
    expect(between(null, "0000000028.5")).toBe("0000000028.3");
  });

  it("GivenABottomCard_WhenPlacedBelowIt_ThenTheRankSortsLast", () => {
    expect(between(rankFor(28), null)).toBe("0000000028.5");
    expect(between("0000000028.9", null)).toBe("0000000028.95");
  });

  it("GivenAnEmptyLane_WhenPlaced_ThenAnyValidRank", () => {
    expect(rankBetween(null, null)).toBe(rankFor(1));
  });

  it("GivenRepeatedMovesToTheSameGap_WhenPlaced_ThenThereIsAlwaysRoom", () => {
    let lo = rankFor(1);
    let hi = rankFor(2);
    for (let i = 0; i < 200; i++) {
      const mid = between(lo, hi);
      if (i % 2) lo = mid;
      else hi = mid;
    }
    let top = rankFor(1);
    for (let i = 0; i < 200; i++) top = between(null, top);
  });

  it("GivenNeighboursOutOfOrder_WhenPlaced_ThenTheRankFollowsTheOneAbove", () => {
    expect(rankBetween(rankFor(5), rankFor(5))).toBe("0000000005.5");
    expect(rankBetween(rankFor(6), rankFor(5))).toBe("0000000006.5");
  });

  it("GivenARankThatIsNotOurs_WhenPlaced_ThenItThrows", () => {
    expect(() => rankBetween("abc", null)).toThrow(/not a rank/);
  });

  it("GivenGeneratedRanks_WhenSortedWithCompareRanks_ThenTheOrderIsStrictAndMatchesInsertion", () => {
    // Build a lane by inserting at the top, the bottom, and repeatedly between the same two
    // neighbours; `lane` holds the intended order throughout.
    const lane = [rankFor(28), rankFor(29), rankFor(30)];
    const insertAt = (i: number) =>
      lane.splice(i, 0, rankBetween(lane[i - 1] ?? null, lane[i] ?? null));
    for (let i = 0; i < 60; i++) insertAt(1); // always just after the first card
    for (let i = 0; i < 30; i++) insertAt(0);
    for (let i = 0; i < 30; i++) insertAt(lane.length);
    for (let i = 0; i < 60; i++) insertAt(Math.floor(lane.length / 2));

    const shuffled = [...lane].reverse();
    expect(shuffled.sort(compareRanks)).toEqual(lane);
    for (let i = 1; i < lane.length; i++) expect(compareRanks(lane[i - 1]!, lane[i]!)).toBe(-1);
    expect(new Set(lane).size).toBe(lane.length);
  });

  it("GivenRanksThatLocaleCompareMightReorder_WhenCompared_ThenCodeUnitOrderWins", () => {
    // '.' (U+002E) sorts before digits by code unit; collation may ignore punctuation.
    expect(compareRanks("0000000028.5", "0000000029")).toBe(-1);
    expect(compareRanks("0000000028", "0000000028.5")).toBe(-1);
    expect(compareRanks("0000000028.5", "0000000028.5")).toBe(0);
  });
});
