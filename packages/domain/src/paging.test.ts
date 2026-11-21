import { describe, expect, it } from "vitest";
import { PAGE_MAX, pageOf } from "./paging";

describe("pageOf (AI-293)", () => {
  const items = Array.from({ length: 7 }, (_, i) => i);

  it("GivenPagesReadInOrder_WhenJoined_ThenTheyAreTheWholeList", () => {
    const first = pageOf(items, 0, 3);
    const second = pageOf(items, first.nextOffset!, 3);
    const third = pageOf(items, second.nextOffset!, 3);
    expect([...first.items, ...second.items, ...third.items]).toEqual(items);
    expect(third.nextOffset).toBeNull();
    expect(first.total).toBe(7);
  });

  it("GivenALimitPastTheCap_WhenPaged_ThenThePageIsCapped", () => {
    const many = Array.from({ length: PAGE_MAX + 10 }, (_, i) => i);
    const page = pageOf(many, 0, 10_000);
    expect(page.items).toHaveLength(PAGE_MAX);
    expect(page.nextOffset).toBe(PAGE_MAX);
  });

  it("GivenAnOffsetPastTheEnd_WhenPaged_ThenTheItemsAreEmpty", () => {
    expect(pageOf(items, 50)).toEqual({ total: 7, offset: 50, items: [], nextOffset: null });
  });
});
