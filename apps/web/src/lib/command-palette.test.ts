import { describe, expect, it } from "vitest";
import { keyCaps, matchesQuery, searchTickets, type PaletteTicket } from "@/lib/command-palette";

const ticket = (key: string, title: string): PaletteTicket => ({
  projectId: key.split("-")[0]!.toLowerCase(),
  projectName: "P",
  key,
  title,
  stage: "ready",
});
const TICKETS = [
  ticket("AI-12", "Rotate runner secrets"),
  ticket("AI-1", "Design source"),
  ticket("OPS-2", "Rotate the deploy key"),
  ticket("AI-10", "Board grouping"),
];

describe("command palette search", () => {
  it("GivenAKey_WhenSearched_ThenTheExactKeyComesFirstThenKeysStartingWithIt", () => {
    expect(searchTickets(TICKETS, "ai-1").map((t) => t.key)).toEqual(["AI-1", "AI-10", "AI-12"]);
  });

  it("GivenTitleWords_WhenSearched_ThenTicketsHoldingEveryWordMatchInAnyCase", () => {
    expect(searchTickets(TICKETS, "rotate KEY").map((t) => t.key)).toEqual(["OPS-2"]);
    expect(searchTickets(TICKETS, "rot").map((t) => t.key)).toEqual(["AI-12", "OPS-2"]);
  });

  it("GivenAnEmptyQuery_WhenSearched_ThenNoTicketsShow", () => {
    expect(searchTickets(TICKETS, "  ")).toEqual([]);
  });

  it("GivenManyMatches_WhenSearched_ThenTheLimitHolds", () => {
    expect(searchTickets(TICKETS, "a", 2)).toHaveLength(2);
  });

  it("GivenACommand_WhenItsLabelOrKeywordsHoldTheWords_ThenItMatches", () => {
    const item = {
      id: "x",
      group: "Go to" as const,
      label: "Roadmap",
      keywords: "go",
      run: () => {},
    };
    expect(matchesQuery(item, "go road")).toBe(true);
    expect(matchesQuery(item, "board")).toBe(false);
  });

  it("GivenAKeySequence_WhenShown_ThenEachKeyIsACap", () => {
    expect(keyCaps("g r")).toEqual(["G", "R"]);
  });
});
