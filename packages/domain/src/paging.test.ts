import { describe, expect, it } from "vitest";
import { pageOf } from "./paging";

const items = [1, 2, 3, 4, 5, 6, 7];

describe("pageOf", () => {
  it("GivenFirstMiddleAndLastPages_WhenPaged_ThenExactlySizeItemsWithoutOverlap", () => {
    expect(pageOf(items, 1, 3)).toEqual([1, 2, 3]);
    expect(pageOf(items, 2, 3)).toEqual([4, 5, 6]);
    expect(pageOf(items, 3, 3)).toEqual([7]);
  });

  it("GivenAPagePastTheEndOrAnEmptyList_WhenPaged_ThenEmpty", () => {
    expect(pageOf(items, 4, 3)).toEqual([]);
    expect(pageOf([], 1, 3)).toEqual([]);
  });

  it("GivenInvalidPageOrSize_WhenPaged_ThenEmpty", () => {
    expect(pageOf(items, 0, 3)).toEqual([]);
    expect(pageOf(items, 1, 0)).toEqual([]);
    expect(pageOf(items, 1, -2)).toEqual([]);
    expect(pageOf(items, 1.5, 3)).toEqual([]);
  });
});
